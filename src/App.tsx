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

// CSV에 "eichi.webp"처럼 파일명만 적으면 지정 폴더(public/img/ 등)에서 찾고,
// "img/eichi.webp"나 "https://..." 처럼 경로/주소를 적으면 그대로 사용
const MEMBER_IMG_DIR = "img";
const LOGO_IMG_DIR = "img/logo";
function resolveImg(value: string | undefined, dir: string): string | undefined {
  const v = (value || "").trim();
  if (!v) return undefined;
  if (/^(https?:|data:)/i.test(v) || v.includes("/")) return resolveAsset(v);
  return resolveAsset(`${dir}/${v}`);
}

// public 폴더의 CSV 파일을 읽어 (키가 정리된) 행 배열로 반환
function loadCsv(file: string): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(`${process.env.PUBLIC_URL || "."}/${file}?${Date.now()}`, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data.map(cleanRow)),
      error: (err) => reject(err)
    });
  });
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
const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "my";

// 화면의 한 영역을 PNG로 저장. expand=true면 가로 스크롤 영역을 전부 펼쳐서 캡처
async function captureToPng(target: HTMLElement, filename: string, expand = false) {
  const originalOverflow = target.style.overflow;
  const originalWidth = target.style.width;
  if (expand) {
    target.style.overflow = "visible";
    target.style.width = `${target.scrollWidth}px`;
  }
  try {
    const canvas = await html2canvas(target, {
      useCORS: true,
      scale: 2,
      backgroundColor: "#ffffff"
    });
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } finally {
    if (expand) {
      target.style.overflow = originalOverflow;
      target.style.width = originalWidth;
    }
  }
}

export default function App() {
  // 인증(익명) — 공유(저장)할 때만 필요합니다. 실패해도 선택/이미지 저장은 가능
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  const [nickname, setNickname] = useState("");
  const [picks, setPicks] = useState<Picks>({});

  const [roomId, setRoomId] = useState<string | null>(() => parseRoomId());
  const [roomUsers, setRoomUsers] = useState<RoomUsers>({});
  const [roomLoaded, setRoomLoaded] = useState<boolean>(() => !parseRoomId());
  const [roomError, setRoomError] = useState(false);

  const [showResult, setShowResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agencies, setAgencies] = useState<Agency[]>([]);

  const boardRef = useRef<HTMLDivElement>(null);
  const personalRef = useRef<HTMLDivElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

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

  // ── CSV 로드 (멤버: ES_list.csv, 유닛 로고: units.csv)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await loadCsv("ES_list.csv");
        if (rows.length > 0 && Object.keys(rows[0]).join("").includes("html")) {
          alert("CSV 파일 경로를 찾지 못해 데이터를 불러올 수 없습니다.");
          return;
        }

        // units.csv: unit,logo  → 유닛·소속사 이름(대소문자 무시)으로 로고 연결. 파일이 없어도 정상 동작
        const logoMap: Record<string, string> = {};
        try {
          const unitRows = await loadCsv("units.csv");
          unitRows.forEach((r) => {
            if (!("unit" in r)) return; // 파일이 없어 404 HTML이 읽힌 경우 무시
            const key = stripQuotes(r.unit).toLowerCase();
            const logo = resolveImg(stripQuotes(r.logo), LOGO_IMG_DIR);
            if (key && logo) logoMap[key] = logo;
          });
        } catch (err) {
          console.warn("units.csv를 읽지 못해 글자 로고를 사용합니다.", err);
        }
        if (cancelled) return;

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
              logo:
                logoMap[unit.name.toLowerCase()] ||
                resolveAsset(unit.logo) ||
                badgeUri(unit.name, 120, 120, true),
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
                  img: resolveImg(stripQuotes(r.img), MEMBER_IMG_DIR) || fallback,
                  fallback
                };
              })
            });
          });
          return {
            id: `agency-${aIdx}`,
            name: cfg.name,
            logo:
              logoMap[cfg.name.toLowerCase()] ||
              resolveAsset(cfg.logo) ||
              badgeUri(cfg.name, 240, 48, false),
            groups
          };
        });

        setAgencies(parsed);
      } catch (err) {
        console.error("CSV 로드 에러:", err);
        alert("CSV 파일을 읽는 중 오류가 발생했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
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

  // 같은 기기로 이 방에 이미 제출한 적이 있으면 닉네임과 픽을 한 번만 복원
  useEffect(() => {
    if (restored.current || !uid || agencies.length === 0) return;
    const mine = roomUsers[uid];
    if (!mine) return;
    restored.current = true;
    setNickname((cur) => cur || mine.nickname);
    setPicks((cur) => {
      if (Object.keys(cur).length > 0) return cur; // 이미 고르기 시작했다면 덮어쓰지 않음
      const r: Picks = {};
      Object.entries(mine.picks).forEach(([gid, mid]) => {
        if (validGroupIds.has(gid) && memberMap[mid]?.groupId === gid) r[gid] = mid;
      });
      return r;
    });
  }, [uid, roomUsers, agencies, validGroupIds, memberMap]);

  const trimmedName = nickname.trim();

  // ── 핸들러
  const handlePick = (groupId: string, member: Member) => {
    setPicks((prev) => ({ ...prev, [groupId]: member.id }));
  };

  const requireComplete = () => {
    if (pickedCount < totalGroups) {
      alert(`${totalGroups}명을 모두 골라주세요. (현재 ${pickedCount}명)`);
      return false;
    }
    return true;
  };

  // 내 선택 이미지 저장 (서버를 거치지 않음 · 닉네임은 선택 사항)
  const savePersonalImage = async () => {
    if (!requireComplete()) return;
    const target = personalRef.current;
    if (!target) return;
    try {
      await captureToPng(target, `${safeFileName(trimmedName || "my")}_picks.png`);
    } catch (err) {
      console.error("이미지 저장 에러:", err);
      alert("이미지 저장에 실패했습니다.");
    }
  };

  // 공유 링크 만들기 / 방에 제출 (닉네임 필수)
  const handleSubmit = async () => {
    if (submitting) return;
    if (!requireComplete()) return;
    if (!trimmedName) {
      alert("공유하려면 닉네임을 입력해주세요.");
      nicknameRef.current?.focus();
      return;
    }
    if (!uid) {
      alert("서버에 연결 중이거나 연결에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
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
        nickname: trimmedName,
        picks: cleanPicks,
        joinedAt: roomUsers[uid]?.joinedAt ?? Date.now()
      });

      if (!roomId) {
        window.history.replaceState({}, "", `?room=${rid}`);
        setRoomId(rid);
      }
      setNickname(trimmedName);
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

  const saveBoardImage = async () => {
    const target = boardRef.current;
    if (!target) return;
    try {
      await captureToPng(target, "multi_picks.png", true);
    } catch (err) {
      console.error("이미지 저장 에러:", err);
      alert("이미지 저장에 실패했습니다.");
    }
  };

  // ── 화면
  if (agencies.length === 0) return <div className="App notice-page">데이터 불러오는 중...</div>;

  const myResultExists = !!uid && !!roomUsers[uid];

  return (
    <div className="App">
      {!showResult ? (
        <>
          <h1>최애 {totalGroups}명 고르기</h1>
          <p className="progress">
            {pickedCount} / {totalGroups}
          </p>

          {roomId && (
            <div className="room-banner">
              <span>
                {roomError
                  ? "방 정보를 불러오지 못했습니다. 링크를 확인해주세요."
                  : roomLoaded
                  ? `공유된 방에 참여 중 · 참여자 ${displayUsers.length}명`
                  : "방 정보를 불러오는 중..."}
              </span>
              {displayUsers.length > 0 && (
                <button type="button" onClick={() => setShowResult(true)}>
                  다른 사람 결과 보기
                </button>
              )}
            </div>
          )}

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

          {/* 내 선택 미리보기 + 저장/공유 */}
          <section className="finish-section">
            <h2 className="finish-title">내 선택</h2>
            <div className="personal-wrap">
              <div ref={personalRef} className="personal-card">
                <h3 className="personal-title">
                  {trimmedName ? `${trimmedName}의 선택` : "나의 선택"}
                </h3>
                <div className="personal-grid">
                  {agencies.map((agency) => (
                    <div key={agency.id} className="personal-agency">
                      <img src={agency.logo} alt={agency.name} className="personal-agency-logo" />
                      <div className="personal-picks">
                        {agency.groups.map((g) => {
                          const m = memberMap[picks[g.id]];
                          const pick = m && m.groupId === g.id ? m : undefined;
                          return (
                            <div key={g.id} className="personal-pick">
                              <div className="slot">
                                {pick ? (
                                  <img src={pick.img} alt={pick.name} onError={onImgError(pick.fallback)} />
                                ) : (
                                  "?"
                                )}
                              </div>
                              <div className="pick-name">{pick ? pick.name : "\u00A0"}</div>
                              <div className="pick-unit">{g.name}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="nickname-row">
              <label htmlFor="nickname">닉네임</label>
              <input
                id="nickname"
                ref={nicknameRef}
                type="text"
                value={nickname}
                maxLength={MAX_NICKNAME_LENGTH}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                }}
                placeholder="예: 하루"
              />
            </div>
            <p className="hint">
              닉네임을 쓰면 이미지에 “닉네임의 선택”으로 들어가요. 이미지 저장은 비워둬도 되고,
              공유 링크를 만들 때는 꼭 필요해요.
            </p>

            <div className="finish-buttons">
              <button className="download-btn" onClick={savePersonalImage} style={{ backgroundColor: "#20c997" }}>
                내 선택 이미지 저장
              </button>
              <button className="download-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "저장 중..." : roomId ? "이 방에 제출하기" : "공유 링크 만들기"}
              </button>
            </div>
            {authError && (
              <p className="hint">서버 연결에 실패해 공유 기능을 쓸 수 없어요. 이미지 저장은 가능합니다.</p>
            )}
          </section>
        </>
      ) : (
        <div className="result-view">
          <div className="result-buttons">
            <button className="download-btn" onClick={copyLink} style={{ backgroundColor: "#4dabf7" }}>
              공유 링크 복사
            </button>
            <button className="download-btn" onClick={() => setShowResult(false)}>
              {myResultExists ? "내 픽 수정하기" : "내 픽 고르기"}
            </button>
            <button className="download-btn" onClick={saveBoardImage} style={{ backgroundColor: "#20c997" }}>
              결과표 이미지 저장
            </button>
          </div>

          <div ref={boardRef} className="comparison-board">
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
                          <img
                            src={g.logo}
                            alt={g.name}
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                          />
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
