import React, { useState, useEffect, useRef, useMemo } from "react";
import html2canvas from "html2canvas";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  DocumentData
} from "firebase/firestore";
import "./styles.css";
import Papa from "papaparse";

// ───────────────────────── Firebase ─────────────────────────
// (웹 API 키는 공개되어도 되는 값입니다. 실제 보호는 Firestore 규칙이 담당합니다.)
const firebaseConfig = {
  apiKey: "AIzaSyC1TjmcvbKHRWkUm1u8isrBzlBNLytXd0o",
  authDomain: "esmulti-fa048.firebaseapp.com",
  projectId: "esmulti-fa048",
  storageBucket: "esmulti-fa048.firebasestorage.app",
  messagingSenderId: "744801772905",
  appId: "1:744801772905:web:5afece605dff29a5b1c9f8",
  measurementId: "G-EJH36NK25P"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ───────────────────────── 타입 ─────────────────────────
interface Member {
  id: string; // "유닛명::멤버명" (CSV 순서와 무관한 안정적인 키)
  groupId: string;
  name: string;
  img: string;
  fallback: string;
}
interface Group {
  id: string; // 유닛명
  name: string;
  logo: string;
  members: Member[];
}
interface Agency {
  id: string;
  name: string;
  logo: string;
  groups: Group[];
}
// 저장 형태: { 유닛명: 멤버id }
type Picks = Record<string, string>;
interface UserDoc {
  nickname: string;
  picks: Picks;
  joinedAt: number;
}
type RoomUsers = Record<string, UserDoc>; // key = 기기(익명 로그인) uid

interface AgencyConfig {
  name: string;
  logo?: string; // 나중에 실제 로고를 쓰려면 "img/logo/xxx.png" 처럼 public 기준 경로
  units: { name: string; logo?: string }[];
}

const agencyConfig: AgencyConfig[] = [
  {
    name: "STARMAKER PRODUCTION",
    units: [{ name: "fine" }, { name: "Trickstar" }, { name: "유성대" }, { name: "ALKALOID" }]
  },
  {
    name: "COSMIC PRODUCTION",
    units: [{ name: "Eden" }, { name: "Valkyrie" }, { name: "2wink" }, { name: "Crazy:B" }]
  },
  {
    name: "Rhythm Link",
    units: [{ name: "UNDEAD" }, { name: "Ra*bits" }, { name: "홍월" }, { name: "MELLOW DEAR US" }]
  },
  {
    name: "NEW DIMENSION",
    units: [{ name: "Knights" }, { name: "Switch" }, { name: "MaM" }, { name: "Special for Princess!" }]
  }
];

const MAX_NICKNAME_LENGTH = 20;
const ROOM_ID_PATTERN = /^[a-z0-9]{6,24}$/;

// ───────────────────────── 유틸 ─────────────────────────
// 외부 이미지 서비스(placeholder 등)에 의존하지 않도록 SVG를 직접 생성합니다.
// (이미지 저장(html2canvas) 시 CORS 문제도 생기지 않습니다.)
const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string)
  );

function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function avatarUri(name: string): string {
  const hue = hueOf(name);
  const label = escapeXml(Array.from(name).slice(0, 2).join(""));
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">` +
      `<rect width="160" height="160" fill="hsl(${hue},55%,82%)"/>` +
      `<text x="80" y="80" font-family="sans-serif" font-size="56" font-weight="700" ` +
      `fill="hsl(${hue},40%,30%)" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`
  );
}

const textWidthUnits = (s: string) =>
  Array.from(s).reduce((sum, ch) => sum + ((ch.codePointAt(0) || 0) > 255 ? 1 : 0.6), 0);

function badgeUri(text: string, w: number, h: number, multiline: boolean): string {
  const words = text.split(" ").filter(Boolean);
  const lines = multiline && words.length > 1 ? words.slice(0, 3) : [text];
  const maxUnits = Math.max(...lines.map(textWidthUnits));
  const fontSize = Math.max(
    8,
    Math.min(w * 0.22, (w * 0.9) / maxUnits, (h * 0.9) / (lines.length * 1.25))
  );
  const lh = fontSize * 1.25;
  const startY = h / 2 - ((lines.length - 1) * lh) / 2;
  const hue = hueOf(text);
  const tspans = lines
    .map((l, i) => `<text x="${w / 2}" y="${startY + i * lh}" text-anchor="middle" dominant-baseline="central">${escapeXml(l)}</text>`)
    .join("");
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" rx="${Math.min(w, h) * 0.12}" fill="hsl(${hue},45%,38%)"/>` +
      `<g font-family="sans-serif" font-weight="700" font-size="${fontSize}" fill="#fff">${tspans}</g></svg>`
  );
}

// 상대 경로는 public 폴더 기준(GitHub Pages 하위 경로에서도 동작)
function resolveAsset(path?: string): string | undefined {
  const p = (path || "").trim();
  if (!p) return undefined;
  if (/^(https?:|data:)/i.test(p)) return p;
  return `${process.env.PUBLIC_URL || "."}/${p.replace(/^\/+/, "")}`;
}

// 멤버 이미지: CSV에 "eichi.webp"처럼 파일명만 적으면 public/img/ 에서 찾고,
// "img/eichi.webp"나 "https://..." 처럼 경로/주소를 적으면 그대로 사용
const MEMBER_IMG_DIR = "img";
function resolveMemberImg(value?: string): string | undefined {
  const v = (value || "").trim();
  if (!v) return undefined;
  if (/^(https?:|data:)/i.test(v) || v.includes("/")) return resolveAsset(v);
  return resolveAsset(`${MEMBER_IMG_DIR}/${v}`);
}

function onImgError(fallback: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const t = e.currentTarget;
    if (t.dataset.fallback !== "1") {
      t.dataset.fallback = "1";
      t.src = fallback;
    }
  };
}

// CSV 행의 키(BOM/공백/대소문자)와 값(따옴표)을 정리
function cleanRow(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    out[key.replace(/^\uFEFF/, "").trim().toLowerCase()] = String(row[key] ?? "");
  }
  return out;
}
const stripQuotes = (v: unknown) => String(v ?? "").replace(/['"]/g, "").trim();

function parseRoomId(): string | null {
  const v = new URLSearchParams(window.location.search).get("room");
  return v && ROOM_ID_PATTERN.test(v) ? v : null; // 이상한 값(예: a/b)은 무시
}

function generateRoomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function parseUserDoc(data: DocumentData): UserDoc | null {
  if (typeof data.nickname !== "string" || typeof data.joinedAt !== "number") return null;
  const picks: Picks = {};
  if (data.picks && typeof data.picks === "object") {
    Object.entries(data.picks).forEach(([g, m]) => {
      if (typeof m === "string") picks[g] = m;
    });
  }
  return { nickname: data.nickname.slice(0, MAX_NICKNAME_LENGTH), picks, joinedAt: data.joinedAt };
}

// ───────────────────────── 앱 ─────────────────────────
export default function App() {
  // 인증(익명) — 기기(브라우저)마다 고유한 uid가 생깁니다.
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  const [nickname, setNickname] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [picks, setPicks] = useState<Picks>({});

  const [roomId, setRoomId] = useState<string | null>(() => parseRoomId());
  const [roomUsers, setRoomUsers] = useState<RoomUsers>({});
  const [roomLoaded, setRoomLoaded] = useState<boolean>(() => !parseRoomId());
  const [roomError, setRoomError] = useState(false);

  const [showResult, setShowResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const captureRef = useRef<HTMLDivElement>(null);
  const prefilled = useRef(false);

  // ── 익명 로그인
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setUid(user.uid);
    });
    signInAnonymously(auth).catch((err) => {
      console.error("익명 로그인 실패:", err);
      setAuthError(true);
    });
    return unsub;
  }, []);

  // ── CSV 로드
  useEffect(() => {
    Papa.parse<Record<string, string>>(
      `${process.env.PUBLIC_URL || "."}/ES_list.csv?${Date.now()}`,
      {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rawData = results.data;
          if (
            rawData.length > 0 &&
            Object.keys(rawData[0]).join("").toLowerCase().includes("html")
          ) {
            alert("CSV 파일 경로를 찾지 못해 데이터를 불러올 수 없습니다.");
            return;
          }

          const rows = rawData.map(cleanRow);
          const usedIds = new Set<string>();

          const parsed: Agency[] = agencyConfig.map((cfg, aIdx) => {
            const groups: Group[] = [];
            cfg.units.forEach((unit) => {
              const unitRows = rows.filter(
                (r) => stripQuotes(r.unit).toLowerCase() === unit.name.toLowerCase()
              );
              if (unitRows.length === 0) return;

              groups.push({
                id: unit.name,
                name: unit.name,
                logo: resolveAsset(unit.logo) || badgeUri(unit.name, 120, 120, true),
                members: unitRows.map((r) => {
                  const mName = stripQuotes(r.name) || "알수없음";
                  let id = `${unit.name}::${mName}`;
                  for (let n = 2; usedIds.has(id); n++) id = `${unit.name}::${mName}#${n}`; // 동명이인 대비
                  usedIds.add(id);
                  const fallback = avatarUri(mName);
                  return {
                    id,
                    groupId: unit.name,
                    name: mName,
                    img: resolveMemberImg(stripQuotes(r.img)) || fallback,
                    fallback
                  };
                })
              });
            });
            return {
              id: `agency-${aIdx}`,
              name: cfg.name,
              logo: resolveAsset(cfg.logo) || badgeUri(cfg.name, 240, 48, false),
              groups
            };
          });

          setAgencies(parsed);
        },
        error: (err) => {
          console.error("CSV 파싱 에러:", err);
          alert("CSV 파일을 읽는 중 오류가 발생했습니다.");
        }
      }
    );
  }, []);

  // ── 방 실시간 구독: rooms/{roomId}/users/{uid}
  useEffect(() => {
    if (!roomId || !uid) return;
    const unsub = onSnapshot(
      collection(db, "rooms", roomId, "users"),
      (snap) => {
        const users: RoomUsers = {};
        snap.forEach((d) => {
          const parsed = parseUserDoc(d.data());
          if (parsed) users[d.id] = parsed;
        });
        setRoomUsers(users);
        setRoomError(false);
        setRoomLoaded(true);
      },
      (err) => {
        console.error("방 구독 에러:", err);
        setRoomError(true);
        setRoomLoaded(true);
      }
    );
    return () => unsub();
  }, [roomId, uid]);

  // 같은 기기로 다시 들어오면 예전 닉네임을 미리 채워줌
  useEffect(() => {
    if (uid && roomUsers[uid] && !prefilled.current) {
      prefilled.current = true;
      setNickname((cur) => cur || roomUsers[uid].nickname);
    }
  }, [uid, roomUsers]);

  // ── 파생 데이터
  const totalGroups = useMemo(() => agencies.reduce((s, a) => s + a.groups.length, 0), [agencies]);
  const memberMap = useMemo(() => {
    const map: Record<string, Member> = {};
    agencies.forEach((a) => a.groups.forEach((g) => g.members.forEach((m) => (map[m.id] = m))));
    return map;
  }, [agencies]);
  const validGroupIds = useMemo(() => {
    const s = new Set<string>();
    agencies.forEach((a) => a.groups.forEach((g) => s.add(g.id)));
    return s;
  }, [agencies]);
  const pickedCount = useMemo(
    () => Object.keys(picks).filter((g) => validGroupIds.has(g)).length,
    [picks, validGroupIds]
  );

  // 닉네임이 겹치면 먼저 들어온 사람은 그대로, 이후 사람은 이름(2), 이름(3) …
  // 표시 순서는 최근 참여자가 위
  const displayUsers = useMemo(() => {
    const asc = Object.entries(roomUsers)
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const seen: Record<string, number> = {};
    return asc
      .map((u) => {
        const key = u.nickname.toLowerCase();
        seen[key] = (seen[key] || 0) + 1;
        return { ...u, label: seen[key] === 1 ? u.nickname : `${u.nickname}(${seen[key]})` };
      })
      .reverse();
  }, [roomUsers]);

  // ── 핸들러
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault(); // form 제출 → 엔터키로도 입장 (한글 입력 중복 방지)
    if (!uid) return;
    const name = nickname.trim();
    if (!name) return alert("닉네임을 입력해주세요.");
    if (name.length > MAX_NICKNAME_LENGTH) {
      return alert(`닉네임은 ${MAX_NICKNAME_LENGTH}자 이하로 입력해주세요.`);
    }

    // 같은 기기(uid)로 이미 제출한 적이 있으면 내 픽을 복원
    const mine = roomUsers[uid];
    if (mine) {
      const restored: Picks = {};
      Object.entries(mine.picks).forEach(([gid, mid]) => {
        if (validGroupIds.has(gid) && memberMap[mid]?.groupId === gid) restored[gid] = mid;
      });
      setPicks(restored);
    }
    setNickname(name);
    setIsLoggedIn(true);
  };

  const handlePick = (groupId: string, member: Member) => {
    setPicks((prev) => ({ ...prev, [groupId]: member.id }));
  };

  const handleSubmit = async () => {
    if (!uid || submitting) return;
    if (pickedCount < totalGroups) {
      return alert(`${totalGroups}명을 모두 골라주세요. (현재 ${pickedCount}명)`);
    }

    setSubmitting(true);
    try {
      const rid = roomId ?? generateRoomId();
      const cleanPicks: Picks = {};
      Object.entries(picks).forEach(([g, m]) => {
        if (validGroupIds.has(g)) cleanPicks[g] = m;
      });

      // 문서 id = 내 uid → 내 데이터만 쓸 수 있고, 닉네임이 같아도 서로 다른 문서로 저장됨
      await setDoc(doc(db, "rooms", rid, "users", uid), {
        nickname,
        picks: cleanPicks,
        joinedAt: roomUsers[uid]?.joinedAt ?? Date.now()
      });

      if (!roomId) {
        window.history.replaceState({}, "", `?room=${rid}`);
        setRoomId(rid);
      }
      setShowResult(true);
    } catch (err) {
      console.error("제출 에러:", err);
      alert("저장 중 오류가 발생했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    const url = window.location.href;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("copy failed");
      }
      alert("공유 링크가 복사되었습니다!");
    } catch {
      alert("복사에 실패했습니다. 주소창의 링크를 직접 복사해주세요.");
    }
  };

  const downloadImage = async () => {
    const target = captureRef.current;
    if (!target) return;
    const originalOverflow = target.style.overflow;
    const originalWidth = target.style.width;
    target.style.overflow = "visible";
    target.style.width = `${target.scrollWidth}px`;
    try {
      const canvas = await html2canvas(target, {
        useCORS: true,
        scale: 2,
        backgroundColor: "#ffffff"
      });
      const link = document.createElement("a");
      link.download = "multi_picks.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("이미지 저장 에러:", err);
      alert("이미지 저장에 실패했습니다.");
    } finally {
      target.style.overflow = originalOverflow;
      target.style.width = originalWidth;
    }
  };

  // ── 화면
  if (authError) {
    return (
      <div className="App notice-page">
        <h2>접속할 수 없습니다</h2>
        <p>인증 서버에 연결하지 못했습니다. 잠시 후 새로고침 해주세요.</p>
      </div>
    );
  }
  if (agencies.length === 0 || !uid) return <div className="App notice-page">데이터 불러오는 중...</div>;

  if (!isLoggedIn) {
    const ready = roomLoaded;
    return (
      <div className="App" style={{ textAlign: "center", marginTop: "100px" }}>
        <h1>{roomId ? "친구의 픽 목록에 참여하기" : "멀티 픽 방 만들기"}</h1>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="사용할 닉네임 입력"
            autoFocus
            style={{ padding: "10px", fontSize: "1rem", marginRight: "10px" }}
          />
          <button type="submit" disabled={!ready} style={{ padding: "10px 20px", fontSize: "1rem" }}>
            {ready ? "입장" : "방 불러오는 중..."}
          </button>
        </form>
        {roomError && (
          <p className="notice">방 정보를 불러오지 못했습니다. 링크가 올바른지 확인해주세요.</p>
        )}
        {roomId && roomLoaded && !roomError && displayUsers.length === 0 && (
          <p className="notice">아직 참여자가 없는 방입니다. 제출하면 이 링크로 방이 열립니다.</p>
        )}
        {roomUsers[uid] && (
          <p className="notice">이 기기로 참여한 기록이 있어 닉네임을 불러왔어요.</p>
        )}
      </div>
    );
  }

  return (
    <div className="App">
      {!showResult ? (
        <>
          <h1>
            {nickname}님의 최애 {totalGroups}명 고르기
          </h1>
          <p className="progress">
            {pickedCount} / {totalGroups}
          </p>
          <div className="agency-list">
            {agencies.map((agency) => (
              <div key={agency.id} className="agency-container">
                <h2 className="agency-title">{agency.name}</h2>
                {agency.groups.map((g) => (
                  <div key={g.id} className="group-row">
                    <div className="group-name">{g.name}</div>
                    <div className="members">
                      {g.members.map((m) => {
                        const selected = picks[g.id] === m.id;
                        return (
                          <div key={m.id} className="member-wrapper">
                            <img
                              src={m.img}
                              alt={m.name}
                              role="button"
                              tabIndex={0}
                              aria-pressed={selected}
                              onError={onImgError(m.fallback)}
                              onClick={() => handlePick(g.id, m)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handlePick(g.id, m);
                                }
                              }}
                              className={selected ? "selected" : ""}
                            />
                            <span className="member-name">{m.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button className="download-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "저장 중..." : "선택 완료 및 결과 보기"}
          </button>
        </>
      ) : (
        <div className="result-view">
          <div className="result-buttons">
            <button className="download-btn" onClick={copyLink} style={{ backgroundColor: "#4dabf7" }}>
              공유 링크 복사
            </button>
            <button className="download-btn" onClick={() => setShowResult(false)}>
              내 픽 수정하기
            </button>
            <button className="download-btn" onClick={downloadImage} style={{ backgroundColor: "#20c997" }}>
              이미지로 저장
            </button>
          </div>

          <div ref={captureRef} className="comparison-board">
            <h2 style={{ textAlign: "center", marginBottom: "30px" }}>참여자별 픽 결과</h2>

            <div className="user-compare-row header-row">
              <div className="compare-user-name"></div>
              <div className="compare-user-picks">
                {agencies.map((agency) => (
                  <div key={`header-${agency.id}`} className="compare-agency-section">
                    <img src={agency.logo} alt={agency.name} className="agency-header-logo" />
                    <div className="agency-groups-row">
                      {agency.groups.map((g) => (
                        <div key={`header-${g.id}`} className="compare-slot header-slot">
                          <img src={g.logo} alt={g.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {displayUsers.map((u) => (
              <div key={u.id} className="user-compare-row">
                <div className="compare-user-name">{u.label}</div>
                <div className="compare-user-picks">
                  {agencies.map((agency) => (
                    <div key={`data-${agency.id}`} className="compare-agency-section data-section">
                      <div className="agency-groups-row">
                        {agency.groups.map((g) => {
                          const pick = memberMap[u.picks[g.id]];
                          return (
                            <div key={g.id} className="compare-slot">
                              {pick && pick.groupId === g.id ? (
                                <img src={pick.img} alt={pick.name} onError={onImgError(pick.fallback)} />
                              ) : (
                                <div className="empty-pick">?</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
