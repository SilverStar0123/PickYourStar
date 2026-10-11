import React, { useState, useEffect, useRef, useMemo } from "react";
import html2canvas from "html2canvas";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  DocumentData
} from "firebase/firestore";
import "./styles.css";
import { layoutLogos } from "./logoLayout";
import { computeMatches } from "./matching";
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
  joinedAt: number; // 정렬용 (밀리초)
  joinedTs: Timestamp | null; // 서버가 기록한 최초 제출 시각 (수정 시 그대로 다시 보냄). 예전 방(숫자 형식)이면 null
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
const MAX_ROOM_NAME = 30;
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
  if (typeof data.nickname !== "string") return null;
  // 서버 시간(Timestamp) 형식이 기본이고, 서버 시간 도입 전에 만든 방(숫자 형식)도 읽을 수 있게 함
  let joinedAt: number;
  let joinedTs: Timestamp | null = null;
  if (data.joinedAt instanceof Timestamp) {
    joinedAt = data.joinedAt.toMillis();
    joinedTs = data.joinedAt;
  } else if (typeof data.joinedAt === "number") {
    joinedAt = data.joinedAt;
  } else {
    return null;
  }
  const picks: Picks = {};
  if (data.picks && typeof data.picks === "object") {
    Object.entries(data.picks).forEach(([g, m]) => {
      if (typeof m === "string") picks[g] = m;
    });
  }
  return {
    nickname: data.nickname.slice(0, MAX_NICKNAME_LENGTH),
    picks,
    joinedAt,
    joinedTs
  };
}

// ───────────────────────── 앱 ─────────────────────────
// 선택 화면 멤버 한 칸 크기(CSS의 .member-wrapper 너비, .members 간격과 맞출 것)
const ITEM_W = 84;
const ITEM_GAP = 12;
const CARD_PADDING = 40; // .agency-container 좌우 패딩 합

// 한 줄에 다 안 들어가면 줄마다 인원을 고르게 나눔 (예: 5명 → 4+1 대신 3+2)
function balancedMaxWidth(count: number, availWidth: number): number {
  const maxPerRow = Math.max(1, Math.floor((availWidth + ITEM_GAP) / (ITEM_W + ITEM_GAP)));
  const rows = Math.ceil(count / maxPerRow);
  const perRow = Math.ceil(count / rows);
  return perRow * ITEM_W + (perRow - 1) * ITEM_GAP;
}

// 결과표 사진 한 칸 크기/간격 (styles.css의 --slot, --gap 기본값과 같게)
const BOARD_SLOT = 76;
const BOARD_GAP = 10;

// ── 익명 통계용 ──
// 닉네임·로그인 id·방 번호는 저장하지 않고, 유닛별로 고른 멤버와 '날짜'만 저장합니다.
// (제출 시각을 남기면 방 데이터와 시각을 맞춰 누구의 기록인지 추측할 수 있어 날짜까지만 남김)
// 같은 기기에서 다시 제출하면 같은 문서를 덮어쓰도록, 로그인과 무관한 임의 번호를 이 브라우저에 보관합니다.
const STATS_ID_KEY = "es_stats_id";
let memoryStatsId: string | null = null;

function getStatsId(): string {
  try {
    const saved = window.localStorage.getItem(STATS_ID_KEY);
    if (saved && /^[a-z0-9]{16,40}$/.test(saved)) return saved;
    const fresh = generateRoomId() + generateRoomId();
    window.localStorage.setItem(STATS_ID_KEY, fresh);
    return fresh;
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 이번 접속 동안만 유지
    if (!memoryStatsId) memoryStatsId = generateRoomId() + generateRoomId();
    return memoryStatsId;
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

// ── 내가 참여한 방 목록 (이 브라우저에만 저장, 로그인 불필요) ──
interface MyRoom {
  id: string;
  nickname: string;
  lastAt: number; // 마지막으로 제출한 시각(표시용, 이 기기 시계 기준)
  roomName?: string; // 방 이름 (없으면 이름 없는 방)
}
const MY_ROOMS_KEY = "es_my_rooms";
const MY_ROOMS_MAX = 30;

function loadMyRooms(): MyRoom[] {
  try {
    const raw = window.localStorage.getItem(MY_ROOMS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x) =>
          x &&
          typeof x.id === "string" &&
          ROOM_ID_PATTERN.test(x.id) &&
          typeof x.nickname === "string" &&
          typeof x.lastAt === "number"
      )
      .map((x) => ({
        id: x.id,
        nickname: x.nickname,
        lastAt: x.lastAt,
        roomName: typeof x.roomName === "string" ? x.roomName : ""
      }))
      .slice(0, MY_ROOMS_MAX);
  } catch {
    return [];
  }
}

function saveMyRooms(list: MyRoom[]) {
  try {
    window.localStorage.setItem(MY_ROOMS_KEY, JSON.stringify(list));
  } catch {
    /* 저장소를 못 쓰는 환경이면 이번 접속에서만 유지 */
  }
}

const formatDate = (ms: number) => new Date(ms).toLocaleDateString("ko-KR");

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
  const listRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(0);
  const [logoRatios, setLogoRatios] = useState<Record<string, number>>({});
  const [myRooms, setMyRooms] = useState<MyRoom[]>(() => loadMyRooms());
  const [roomName, setRoomName] = useState(""); // 현재 방의 이름 (서버)
  const [roomOwner, setRoomOwner] = useState<string | null>(null); // 현재 방을 만든 사람의 uid
  const [roomMetaLoaded, setRoomMetaLoaded] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState(""); // 새 방을 만들 때 입력하는 이름
  const [showMatch, setShowMatch] = useState(false); // 결과표의 일치율 표시 on/off
  const [baseChoice, setBaseChoice] = useState<string | null>(null); // 일치율 기준 참여자

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

  // ── 방 정보(이름, 만든 사람) 구독: rooms/{roomId}
  useEffect(() => {
    if (!roomId || !uid) return;
    const unsub = onSnapshot(
      doc(db, "rooms", roomId),
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        setRoomName(d && typeof d.name === "string" ? d.name : "");
        setRoomOwner(d && typeof d.ownerUid === "string" ? d.ownerUid : null);
        setRoomMetaLoaded(true);
      },
      (err) => console.warn("방 정보 구독 에러:", err)
    );
    return () => unsub();
  }, [roomId, uid]);

  // 방 이름이 바뀌면 '내가 참여한 방' 목록의 이름도 맞춰 둠
  useEffect(() => {
    if (!roomId || !roomMetaLoaded) return;
    setMyRooms((prev) => {
      const idx = prev.findIndex((r) => r.id === roomId);
      if (idx < 0 || (prev[idx].roomName || "") === roomName) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], roomName };
      saveMyRooms(next);
      return next;
    });
  }, [roomId, roomName, roomMetaLoaded]);

  // ── 방 실시간 구독: rooms/{roomId}/users/{uid}
  useEffect(() => {
    if (!roomId || !uid) return;
    const unsub = onSnapshot(
      collection(db, "rooms", roomId, "users"),
      (snap) => {
        const users: RoomUsers = {};
        snap.forEach((d) => {
          const parsed = parseUserDoc(d.data({ serverTimestamps: "estimate" }));
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

  // 선택 화면 폭을 측정해서 멤버 줄바꿈을 균형 있게 계산
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setListWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setListWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [agencies.length, showResult]);

  // 유닛 로고의 가로세로 비율을 미리 읽어 둠 (결과표에서 로고 크기를 맞추는 데 사용)
  useEffect(() => {
    let cancelled = false;
    agencies.forEach((a) =>
      a.groups.forEach((g) => {
        const im = new Image();
        im.onload = () => {
          if (cancelled || !im.naturalHeight) return;
          const ratio = im.naturalWidth / im.naturalHeight;
          setLogoRatios((prev) => (prev[g.id] === ratio ? prev : { ...prev, [g.id]: ratio }));
        };
        im.src = g.logo;
      })
    );
    return () => {
      cancelled = true;
    };
  }, [agencies]);

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

  // 소속사별 유닛 로고 크기 (비율이 다른 로고도 눈에 비슷한 크기로 보이게)
  const logoBoxes = useMemo(() => {
    const out: Record<string, { w: number; h: number }[]> = {};
    agencies.forEach((a) => {
      out[a.id] = layoutLogos(
        a.groups.map((g) => logoRatios[g.id] ?? 1),
        { pitch: BOARD_SLOT + BOARD_GAP }
      );
    });
    return out;
  }, [agencies, logoRatios]);

  // 닉네임이 겹치면 먼저 들어온 사람은 그대로, 이후 사람은 이름(2), 이름(3) …
  // 표시 순서는 먼저 제출한 사람이 위(오름차순)
  const displayUsers = useMemo(() => {
    const asc = Object.entries(roomUsers)
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const seen: Record<string, number> = {};
    return asc.map((u) => {
      const key = u.nickname.toLowerCase();
      seen[key] = (seen[key] || 0) + 1;
      return { ...u, label: seen[key] === 1 ? u.nickname : `${u.nickname}(${seen[key]})` };
    });
  }, [roomUsers]);

  // 일치율 기준 참여자: 직접 고른 사람 → 없으면 나 → 없으면 가장 먼저 제출한 사람
  const baseUserId = useMemo(() => {
    if (baseChoice && roomUsers[baseChoice]) return baseChoice;
    if (uid && roomUsers[uid]) return uid;
    return displayUsers[0]?.id ?? null;
  }, [baseChoice, uid, roomUsers, displayUsers]);

  const matches = useMemo(() => {
    if (!baseUserId || !roomUsers[baseUserId]) return null;
    return computeMatches(roomUsers[baseUserId].picks, roomUsers, Array.from(validGroupIds));
  }, [baseUserId, roomUsers, validGroupIds]);

  // 기준 참여자를 제외하고 가장 많이 일치한 사람(0개면 없음)
  const bestMatchCount = useMemo(() => {
    if (!matches || !baseUserId) return 0;
    return Object.entries(matches).reduce(
      (mx, [id, m]) => (id === baseUserId ? mx : Math.max(mx, m.count)),
      0
    );
  }, [matches, baseUserId]);

  const matchOn = showMatch && !!matches && displayUsers.length >= 2;
  const baseLabel = displayUsers.find((u) => u.id === baseUserId)?.label ?? "";

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

  // 완성된 선택을 익명 통계로 보냄 (실패해도 사용자에게는 영향 없음)
  const sendAnonymousStats = (finalPicks: Picks) => {
    if (!uid) return; // 인증 전이면 건너뜀
    const clean: Picks = {};
    Object.entries(finalPicks).forEach(([g, m]) => {
      if (validGroupIds.has(g)) clean[g] = m;
    });
    setDoc(doc(db, "stats", getStatsId()), { picks: clean, day: todayUtc(), v: 1 }).catch((err) =>
      console.warn("익명 통계 저장 실패(무시):", err)
    );
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
    sendAnonymousStats(picks);
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
    if (roomId && !roomLoaded) {
      alert("방 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    // 서버 시간 도입 전에 만든 예전 방의 내 기록은 수정할 수 없음 (보기만 가능)
    if (uid && roomUsers[uid] && !roomUsers[uid].joinedTs) {
      alert("이 방은 이전 버전에서 만들어져 내 기록을 수정할 수 없어요. 결과는 볼 수 있고, 수정하려면 '새 방 만들기'로 새로 제출해주세요.");
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
      const userRef = doc(db, "rooms", rid, "users", uid);
      const userData = {
        nickname: trimmedName,
        picks: cleanPicks,
        // 처음 제출할 때만 서버 시간이 기록되고, 수정할 때는 기존 값을 그대로 유지
        joinedAt: roomUsers[uid]?.joinedTs ?? serverTimestamp()
      };

      const creating = !roomId;
      const newRoomName = roomNameInput.trim().slice(0, MAX_ROOM_NAME);
      if (creating) {
        // 새 방: 방 정보(이름, 만든 사람)와 내 기록을 한 번에(둘 다 성공하거나 둘 다 실패) 저장
        const batch = writeBatch(db);
        batch.set(doc(db, "rooms", rid), { name: newRoomName, ownerUid: uid });
        batch.set(userRef, userData);
        await batch.commit();
      } else {
        await setDoc(userRef, userData);
      }

      sendAnonymousStats(cleanPicks);

      const nextRooms = [
        {
          id: rid,
          nickname: trimmedName,
          lastAt: Date.now(),
          roomName: creating ? newRoomName : roomName
        },
        ...myRooms.filter((r) => r.id !== rid)
      ].slice(0, MY_ROOMS_MAX);
      setMyRooms(nextRooms);
      saveMyRooms(nextRooms);

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

  // 지금 방에서 나가 새 방을 만들 준비: 고른 픽과 닉네임은 유지, 기존 방의 제출 기록은 그대로 남음
  const startNewRoom = () => {
    const ok = window.confirm(
      "새 방을 만들까요?\n지금 고른 픽과 닉네임은 그대로 두고, 공유 링크만 새로 만들 수 있어요.\n(지금 방에 낸 내 기록은 그대로 남아요)"
    );
    if (!ok) return;
    window.history.replaceState({}, "", window.location.pathname);
    setRoomId(null);
    setRoomUsers({});
    setRoomName("");
    setRoomOwner(null);
    setRoomMetaLoaded(false);
    setRoomNameInput("");
    setRoomError(false);
    setRoomLoaded(true);
    setShowResult(false);
    window.scrollTo({ top: 0 });
  };

  // 내가 참여했던 방으로 이동 (그 방에 낸 내 픽은 자동으로 다시 불러옴)
  const openRoom = (id: string) => {
    if (id === roomId) return;
    if (pickedCount > 0) {
      const ok = window.confirm("다른 방으로 이동하면 지금 고르던 픽은 사라져요. 이동할까요?");
      if (!ok) return;
    }
    window.history.replaceState({}, "", `${window.location.pathname}?room=${id}`);
    restored.current = false;
    setPicks({});
    setRoomUsers({});
    setRoomName("");
    setRoomOwner(null);
    setRoomMetaLoaded(false);
    setRoomError(false);
    setRoomLoaded(false);
    setRoomId(id);
    setShowResult(true);
    window.scrollTo({ top: 0 });
  };

  // 방을 만든 사람만 이름 변경 가능 (규칙에서도 막음)
  const renameRoom = async () => {
    if (!roomId || !uid || roomOwner !== uid) return;
    const input = window.prompt(`새 방 이름 (최대 ${MAX_ROOM_NAME}자)`, roomName);
    if (input === null) return;
    try {
      await updateDoc(doc(db, "rooms", roomId), { name: input.trim().slice(0, MAX_ROOM_NAME) });
    } catch (err) {
      console.error("방 이름 변경 에러:", err);
      alert("방 이름을 바꾸지 못했습니다. 방을 만든 사람만 바꿀 수 있어요.");
    }
  };

  // 목록에서만 지움 (방 자체나 서버의 기록은 그대로)
  const removeMyRoom = (id: string) => {
    const next = myRooms.filter((r) => r.id !== id);
    setMyRooms(next);
    saveMyRooms(next);
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

  const myRoomsPanel =
    myRooms.length > 0 ? (
      <details className="my-rooms">
        <summary>내가 참여한 방 ({myRooms.length})</summary>
        <ul>
          {myRooms.map((r) => (
            <li key={r.id} className={r.id === roomId ? "current" : ""}>
              <button
                type="button"
                className="room-link"
                onClick={() => openRoom(r.id)}
                disabled={r.id === roomId}
              >
                <span className="room-title">{r.roomName || "이름 없는 방"}</span>
                <span className="room-nick">{r.nickname}</span>
                <span className="room-date">{formatDate(r.lastAt)}</span>
                <span className="room-code">{r.id.slice(0, 6)}…</span>
                {r.id === roomId && <span className="room-now">현재 방</span>}
              </button>
              <button
                type="button"
                className="room-remove"
                aria-label="목록에서 삭제"
                onClick={() => removeMyRoom(r.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <p className="hint-inline">이 기기에만 저장돼요. 목록에서 지워도 방 자체는 사라지지 않아요.</p>
      </details>
    ) : null;

  return (
    <div className="App">
      {!showResult ? (
        <>
          {myRoomsPanel}
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
                  ? `공유된 방에 참여 중${roomName ? ` · ${roomName}` : ""} · 참여자 ${displayUsers.length}명`
                  : "방 정보를 불러오는 중..."}
              </span>
              {displayUsers.length > 0 && (
                <button type="button" onClick={() => setShowResult(true)}>
                  다른 사람 결과 보기
                </button>
              )}
              <button type="button" className="ghost" onClick={startNewRoom}>
                새 방 만들기
              </button>
            </div>
          )}

          <div className="agency-list" ref={listRef}>
            {agencies.map((agency) => (
              <div key={agency.id} className="agency-container">
                <h2 className="agency-title">{agency.name}</h2>
                {agency.groups.map((g) => (
                  <div key={g.id} className="group-row">
                    <div className="group-name">{g.name}</div>
                    <div
                      className="members"
                      style={
                        listWidth
                          ? { maxWidth: balancedMaxWidth(g.members.length, listWidth - CARD_PADDING) }
                          : undefined
                      }
                    >
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

            {!roomId && (
              <>
                <div className="nickname-row">
                  <label htmlFor="roomname">방 이름</label>
                  <input
                    id="roomname"
                    type="text"
                    value={roomNameInput}
                    maxLength={MAX_ROOM_NAME}
                    onChange={(e) => setRoomNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                    }}
                    placeholder="예: 우리 모임 최애 모음 (선택)"
                  />
                </div>
                <p className="hint">
                  공유 링크를 만들 때만 정할 수 있어요. 결과표 이미지에 “방이름의 결과”로 표시되고,
                  방을 만든 사람만 나중에 바꿀 수 있어요.
                </p>
              </>
            )}

            <div className="finish-buttons">
              <button className="download-btn" onClick={savePersonalImage} style={{ backgroundColor: "#20c997" }}>
                내 선택 이미지 저장
              </button>
              <button className="download-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "저장 중..." : roomId ? "이 방에 제출하기" : "공유 링크 만들기"}
              </button>
            </div>
            <p className="hint">
              완성한 선택은 닉네임·방 정보 없이 <b>익명 통계</b>에 반영돼요.
            </p>
            {authError && (
              <p className="hint">서버 연결에 실패해 공유 기능을 쓸 수 없어요. 이미지 저장은 가능합니다.</p>
            )}
          </section>
        </>
      ) : (
        <div className="result-view">
          {myRoomsPanel}
          {!roomLoaded && <p className="hint-inline" style={{ textAlign: "center" }}>방 정보를 불러오는 중...</p>}
          {roomError && (
            <p className="hint-inline" style={{ textAlign: "center" }}>
              방 정보를 불러오지 못했습니다. 링크를 확인해주세요.
            </p>
          )}
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
            <button className="download-btn" onClick={startNewRoom} style={{ backgroundColor: "#868e96" }}>
              새 방 만들기
            </button>
            {!!uid && roomOwner === uid && (
              <button className="download-btn" onClick={renameRoom} style={{ backgroundColor: "#845ef7" }}>
                방 이름 수정
              </button>
            )}
          </div>

          <div className="board-options">
            <label className={`switch ${displayUsers.length < 2 ? "disabled" : ""}`}>
              <input
                type="checkbox"
                role="switch"
                checked={showMatch}
                disabled={displayUsers.length < 2}
                onChange={(e) => setShowMatch(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span>일치율 표시</span>
            </label>
            {matchOn && (
              <label>
                기준{" "}
                <select value={baseUserId ?? ""} onChange={(e) => setBaseChoice(e.target.value)}>
                  {displayUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                      {u.id === uid ? " (나)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {displayUsers.length < 2 && (
              <span className="hint-inline">참여자가 2명 이상이면 사용할 수 있어요</span>
            )}
          </div>

          <div
            ref={boardRef}
            className="comparison-board"
            style={{ ["--slot" as any]: `${BOARD_SLOT}px`, ["--gap" as any]: `${BOARD_GAP}px` }}
          >
            <h2 style={{ textAlign: "center", marginBottom: matchOn ? "6px" : "30px" }}>
              {roomName ? `${roomName}의 결과` : "참여자별 픽 결과"}
            </h2>
            {matchOn && (
              <p className="match-subtitle">
                {baseLabel}님 기준 일치율 · 같은 픽은 빨간 테두리
              </p>
            )}

            <div className="user-compare-row header-row">
              <div className="compare-user-name"></div>
              <div className="compare-user-picks">
                {agencies.map((agency) => (
                  <div key={`header-${agency.id}`} className="compare-agency-section">
                    <img src={agency.logo} alt={agency.name} className="agency-header-logo" />
                    <div className="agency-groups-row">
                      {agency.groups.map((g, gi) => {
                        const box = logoBoxes[agency.id]?.[gi];
                        return (
                          <div key={`header-${g.id}`} className="compare-slot header-slot">
                            <img
                              src={g.logo}
                              alt={g.name}
                              className="header-logo"
                              style={box ? { width: box.w, height: box.h } : undefined}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {matchOn && <div className="compare-match match-head">일치율</div>}
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
                          const basePick = baseUserId ? roomUsers[baseUserId]?.picks[g.id] : undefined;
                          const same = matchOn && u.id !== baseUserId && !!basePick && basePick === u.picks[g.id];
                          return (
                            <div key={g.id} className={`compare-slot${same ? " matched" : ""}`}>
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
                {matchOn && matches && (
                  <div
                    className={`compare-match${
                      u.id !== baseUserId && bestMatchCount > 0 && matches[u.id]?.count === bestMatchCount
                        ? " match-best"
                        : ""
                    }`}
                  >
                    {u.id === baseUserId ? (
                      <div className="match-base">기준</div>
                    ) : (
                      <>
                        <div className="match-percent">
                          {Math.round(((matches[u.id]?.count ?? 0) / (matches[u.id]?.total || 1)) * 100)}%
                        </div>
                        <div className="match-count">
                          {matches[u.id]?.count ?? 0}/{matches[u.id]?.total ?? 0}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
