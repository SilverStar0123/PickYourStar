import React, { useState, useEffect, useRef, useMemo } from "react";
import html2canvas from "html2canvas";
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import type { Firestore } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  orderBy,
  limit,
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


// 로컬 개발(yarn start)에서는 디버그 토큰 사용 (배포된 사이트에는 영향 없음)
if (process.env.NODE_ENV !== "production") {
  (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider("6Lf-X-stAAAAAFh0ZxaXocD47hQkQ0q43GByaQ-L"),
  isTokenAutoRefreshEnabled: true
});

const db = getFirestore(app);
const auth = getAuth(app);

// 다른 서버를 '읽기 전용'으로 함께 쓰고 싶을 때만 위와 같은 형식의 값을 여기에 채우세요.
// (예: 서버를 옮긴 뒤에도 예전 방을 계속 보여주고 싶을 때) 지금은 사용하지 않음(null).
const legacyFirebaseConfig: typeof firebaseConfig | null = null;
const legacyApp = legacyFirebaseConfig ? initializeApp(legacyFirebaseConfig, "legacy") : null;
const legacyDb = legacyApp ? getFirestore(legacyApp) : null;
const legacyAuth = legacyApp ? getAuth(legacyApp) : null;

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

// 이름을 고친 캐릭터의 옛 id → 현재 id (CSV 이름을 바꿀 때마다 한 줄씩 추가)
const ID_ALIASES: Record<string, string> = {
  "Crazy:B::오오카와 코하쿠": "Crazy:B::오우카와 코하쿠",
  "Crazy:B::오으카와 코하쿠": "Crazy:B::오우카와 코하쿠", // 잘못 입력했던 기간에 저장됐을 수 있는 철자
};

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
      if (typeof m === "string") picks[g] = ID_ALIASES[m] ?? m;
    });
  }
  return {
    nickname: data.nickname.slice(0, MAX_NICKNAME_LENGTH),
    picks,
    joinedAt,
    joinedTs
  };
}

// ───────────────────────── 방 불러오기 (서버 읽기 절약) ─────────────────────────
// 무료 한도 때문에 실시간 연결 대신 '한 번 읽고 이 기기에 저장'하는 방식을 씀
const ROOM_CACHE_PREFIX = "es_room_cache:";
const ROOM_CACHE_INDEX = "es_room_cache_index";
const ROOM_CACHE_KEEP = 8; // 이 기기에 저장해 둘 최근 방 개수
const ROOM_CACHE_TTL_MS = 20 * 60 * 1000; // 이 시간 안에 다시 열면 서버를 읽지 않음
const MAX_USERS_PER_ROOM = 50; // 한 번에 읽어 오는 최대 참여자 수 (먼저 제출한 순). 방을 열 때마다 이만큼 읽기가 발생함
const REFRESH_COOLDOWN_MS = 60 * 1000; // 새로고침 버튼 최소 간격
const SUBMIT_COOLDOWN_MS = 15 * 1000; // 제출 버튼 최소 간격 (연타 방지)

interface RoomData {
  source: "main" | "legacy"; // legacy = 이전 서버의 방 (읽기 전용)
  at: number; // 서버에서 읽어 온 시각
  name: string;
  ownerUid: string | null;
  users: RoomUsers;
}

function saveRoomCache(rid: string, d: RoomData) {
  try {
    const users: Record<string, unknown> = {};
    Object.entries(d.users).forEach(([id, u]) => {
      users[id] = {
        nickname: u.nickname,
        picks: u.picks,
        joinedAt: u.joinedAt,
        ts: u.joinedTs ? [u.joinedTs.seconds, u.joinedTs.nanoseconds] : null
      };
    });
    window.localStorage.setItem(
      ROOM_CACHE_PREFIX + rid,
      JSON.stringify({ source: d.source, at: d.at, name: d.name, ownerUid: d.ownerUid, users })
    );
    let index: string[] = [];
    try {
      index = JSON.parse(window.localStorage.getItem(ROOM_CACHE_INDEX) || "[]");
    } catch {
      index = [];
    }
    index = [rid, ...index.filter((x) => x !== rid)];
    index.slice(ROOM_CACHE_KEEP).forEach((old) => window.localStorage.removeItem(ROOM_CACHE_PREFIX + old));
    window.localStorage.setItem(ROOM_CACHE_INDEX, JSON.stringify(index.slice(0, ROOM_CACHE_KEEP)));
  } catch {
    /* 저장 공간이 부족하거나 쓸 수 없으면 캐시만 건너뜀 */
  }
}

function loadRoomCache(rid: string): RoomData | null {
  try {
    const raw = window.localStorage.getItem(ROOM_CACHE_PREFIX + rid);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || typeof o.at !== "number") return null;
    const users: RoomUsers = {};
    Object.entries(o.users || {}).forEach(([id, v]) => {
      const u = v as { nickname?: unknown; picks?: unknown; joinedAt?: unknown; ts?: unknown };
      if (typeof u.nickname !== "string" || typeof u.joinedAt !== "number") return;
      const picks: Picks = {};
      if (u.picks && typeof u.picks === "object") {
        Object.entries(u.picks as Record<string, unknown>).forEach(([g, m]) => {
          if (typeof m === "string") picks[g] = m;
        });
      }
      const ts = Array.isArray(u.ts) && u.ts.length === 2 ? new Timestamp(u.ts[0], u.ts[1]) : null;
      users[id] = { nickname: u.nickname, picks, joinedAt: u.joinedAt, joinedTs: ts };
    });
    return {
      source: o.source === "legacy" ? "legacy" : "main",
      at: o.at,
      name: typeof o.name === "string" ? o.name : "",
      ownerUid: typeof o.ownerUid === "string" ? o.ownerUid : null,
      users
    };
  } catch {
    return null;
  }
}

async function fetchRoomFrom(dbx: Firestore, rid: string, source: "main" | "legacy"): Promise<RoomData> {
  const [meta, snap] = await Promise.all([
    getDoc(doc(dbx, "rooms", rid)),
    getDocs(
      query(collection(dbx, "rooms", rid, "users"), orderBy("joinedAt"), limit(MAX_USERS_PER_ROOM))
    )
  ]);
  const users: RoomUsers = {};
  snap.forEach((d) => {
    const parsed = parseUserDoc(d.data({ serverTimestamps: "estimate" }));
    if (parsed) users[d.id] = parsed;
  });
  const md = meta.exists() ? meta.data() : null;
  return {
    source,
    at: Date.now(),
    name: md && typeof md.name === "string" ? md.name : "",
    ownerUid: md && typeof md.ownerUid === "string" ? md.ownerUid : null,
    users
  };
}

async function fetchRoom(rid: string): Promise<RoomData> {
  const main = await fetchRoomFrom(db, rid, "main");
  if (Object.keys(main.users).length > 0) return main;
  // 새 서버에 없는 방이면 이전 서버(읽기 전용)에서 찾아봄 (이전 서버를 설정한 경우에만)
  if (!legacyDb || !legacyAuth) return main;
  try {
    await legacyAuth.authStateReady();
    if (!legacyAuth.currentUser) await signInAnonymously(legacyAuth);
    const legacy = await fetchRoomFrom(legacyDb, rid, "legacy");
    if (Object.keys(legacy.users).length > 0) return legacy;
  } catch (err) {
    console.warn("이전 서버 조회 실패:", err);
  }
  return main;
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

// 무료 한도(쓰기)를 아끼기 위해 일부 기기만 통계를 보냄 (기기마다 한 번 정해서 계속 유지)
// 0 = 통계 끔, 1 = 모든 기기 (한도에 여유가 생기면 올리면 됨)
const STATS_SAMPLE_RATE = 0.1; // 무료 쓰기 한도를 위해 10%만 수집
const STATS_LANG = "ko"; // 영어/일본어 화면을 추가하면 선택된 언어로 바꾸기 ("ko" | "en" | "ja")
const STATS_SAMPLE_KEY = "es_stats_sample";

function shouldSendStats(): boolean {
  if (STATS_SAMPLE_RATE <= 0) return false;
  if (STATS_SAMPLE_RATE >= 1) return true;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STATS_SAMPLE_KEY) || "null");
    if (saved && saved.rate === STATS_SAMPLE_RATE && typeof saved.yes === "boolean") return saved.yes;
    const yes = Math.random() < STATS_SAMPLE_RATE;
    window.localStorage.setItem(STATS_SAMPLE_KEY, JSON.stringify({ rate: STATS_SAMPLE_RATE, yes }));
    return yes;
  } catch {
    return Math.random() < STATS_SAMPLE_RATE;
  }
}

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

// ── 내 선택·닉네임을 이 기기에 저장 (서버 연결 없이도 새로고침/재방문 후 유지) ──
const PICKS_KEY = "es_my_picks";
const NICK_KEY = "es_my_nickname";

function loadLocalPicks(): Picks {
  try {
    const raw = window.localStorage.getItem(PICKS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const out: Picks = {};
    if (obj && typeof obj === "object") {
      Object.entries(obj).forEach(([g, m]) => {
        if (typeof m === "string") out[g] = m;
      });
    }
    return out;
  } catch {
    return {};
  }
}

function loadLocalNickname(): string {
  try {
    return (window.localStorage.getItem(NICK_KEY) || "").slice(0, MAX_NICKNAME_LENGTH);
  } catch {
    return "";
  }
}

function saveLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 저장소를 못 쓰는 환경이면 이번 접속에서만 유지 */
  }
}

const formatDate = (ms: number) => new Date(ms).toLocaleDateString("ko-KR");

// ── 서버 혼잡(무료 한도 초과 등) 처리 ──
const SERVER_BUSY_KEY = "es_server_busy_until";
const SERVER_BUSY_MS = 10 * 60 * 1000; // 혼잡 판정 후 이 시간 동안은 서버 저장을 시도하지 않음
const SERVER_BUSY_MSG =
  "현재 서버가 혼잡하여 저장이 안 돼요. 다음에 시도해주세요.\n(내 선택 이미지 저장은 계속 가능해요)";

function isServerBusyError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === "resource-exhausted" ||
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    (err as Error)?.message === "timeout"
  );
}

function isServerBusyNow(): boolean {
  try {
    return Number(window.localStorage.getItem(SERVER_BUSY_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function markServerBusy() {
  saveLocal(SERVER_BUSY_KEY, String(Date.now() + SERVER_BUSY_MS));
}

function samePicks(a: Picks, b: Picks): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

// 서버가 응답하지 않을 때 '저장 중...'에서 영원히 멈추지 않도록
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "my";

// ── 이미지 저장 ──
// 기본은 항상 2배 해상도(기존과 동일). 캔버스가 너무 커서 실패했을 때만 낮춰서 한 번 더 시도함
const IMAGE_SCALE = 2;
// 카카오톡·인스타 등 앱 안 브라우저는 파일 다운로드를 막는 경우가 많아 미리보기(길게 눌러 저장)를 사용
const IN_APP_BROWSER = /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|Twitter|DaumApps|everytimeApp|; wv\)/i;

async function renderOnce(target: HTMLElement, scale: number): Promise<Blob> {
  const canvas = await html2canvas(target, {
    useCORS: true,
    scale,
    backgroundColor: "#ffffff",
    logging: false,
    imageTimeout: 10000
  });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 실패"))), "image/png")
  );
}

// 화면의 한 영역을 PNG(Blob)로 만듦. expand=true면 가로 스크롤 영역을 전부 펼쳐서 캡처
async function renderToBlob(target: HTMLElement, expand: boolean): Promise<Blob> {
  const originalOverflow = target.style.overflow;
  const originalWidth = target.style.width;
  if (expand) {
    target.style.overflow = "visible";
    target.style.width = `${target.scrollWidth}px`;
  }
  try {
    try {
      return await renderOnce(target, IMAGE_SCALE);
    } catch (err) {
      console.warn("2배 해상도 저장 실패, 낮춰서 다시 시도:", err);
      return await renderOnce(target, 1);
    }
  } finally {
    if (expand) {
      target.style.overflow = originalOverflow;
      target.style.width = originalWidth;
    }
  }
}

// ── 개인 취향표 이미지: html2canvas 없이 캔버스에 직접 그림 (모바일/앱 안 브라우저에서도 안정적) ──
function loadImage(src: string, fallback?: string): Promise<HTMLImageElement | null> {
  const tryLoad = (u: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      const timer = setTimeout(() => resolve(null), 8000);
      im.onload = () => {
        clearTimeout(timer);
        resolve(im);
      };
      im.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      if (!/^data:/i.test(u)) im.crossOrigin = "anonymous";
      im.src = u;
    });
  return tryLoad(src).then((im) => im ?? (fallback ? tryLoad(fallback) : null));
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderPersonalBlob(
  agencies: Agency[],
  picks: Picks,
  memberMap: Record<string, Member>,
  title: string
): Promise<Blob> {
  // styles.css의 .personal-card 와 같은 크기/간격 (화면 미리보기와 같은 모양)
  const W = 560, PAD = 24, GRID_GAP = 14, BOX_PAD = 12, PICK_GAP = 10, SLOT = 106, LOGO_H = 40;
  const NAME_LH = 15.6, UNIT_H = 13;
  const boxW = (W - PAD * 2 - GRID_GAP) / 2;
  const colW = (boxW - BOX_PAD * 2 - PICK_GAP) / 2;
  const NAME_FONT = "bold 12px sans-serif";

  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("canvas 미지원");
  const mctx: CanvasRenderingContext2D = probe;
  mctx.font = NAME_FONT;
  const wrap = (text: string, maxW: number): string[] => {
    const lines: string[] = [];
    let cur = "";
    const pushLong = (word: string) => {
      Array.from(word).forEach((ch) => {
        if (cur && mctx.measureText(cur + ch).width > maxW) {
          lines.push(cur);
          cur = ch;
        } else cur += ch;
      });
    };
    text
      .split(" ")
      .filter(Boolean)
      .forEach((word) => {
        const trial = cur ? `${cur} ${word}` : word;
        if (mctx.measureText(trial).width <= maxW) cur = trial;
        else if (!cur) pushLong(word);
        else {
          lines.push(cur);
          cur = "";
          pushLong(word);
        }
      });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  // 이미지 미리 불러오기
  const logos = await Promise.all(agencies.map((a) => loadImage(a.logo)));
  const pickImgs = await Promise.all(
    agencies.map((a) =>
      Promise.all(
        a.groups.map((g) => {
          const m = memberMap[picks[g.id]];
          return m && m.groupId === g.id ? loadImage(m.img, m.fallback) : Promise.resolve(null);
        })
      )
    )
  );

  // 높이 계산
  const pickLines = agencies.map((a) =>
    a.groups.map((g) => {
      const m = memberMap[picks[g.id]];
      return m && m.groupId === g.id ? wrap(m.name, colW) : [""];
    })
  );
  const rowHeights = agencies.map((a, ai) => {
    const rows: number[] = [];
    a.groups.forEach((_, gi) => {
      const r = Math.floor(gi / 2);
      const h = SLOT + 5 + pickLines[ai][gi].length * NAME_LH + UNIT_H;
      rows[r] = Math.max(rows[r] || 0, h);
    });
    return rows;
  });
  const boxHeights = rowHeights.map(
    (rows) => BOX_PAD * 2 + LOGO_H + 10 + rows.reduce((x, y) => x + y, 0) + PICK_GAP * Math.max(0, rows.length - 1)
  );
  const gridRows = Math.ceil(agencies.length / 2);
  const gridRowH: number[] = [];
  boxHeights.forEach((h, i) => {
    const r = Math.floor(i / 2);
    gridRowH[r] = Math.max(gridRowH[r] || 0, h);
  });
  const TITLE_H = 24;
  const H = PAD + TITLE_H + 18 + gridRowH.reduce((x, y) => x + y, 0) + GRID_GAP * Math.max(0, gridRows - 1) + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * IMAGE_SCALE);
  canvas.height = Math.round(H * IMAGE_SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 미지원");
  ctx.scale(IMAGE_SCALE, IMAGE_SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#333333";
  ctx.font = "bold 20.8px sans-serif";
  ctx.fillText(title, W / 2, PAD + TITLE_H / 2, W - PAD * 2);

  agencies.forEach((agency, ai) => {
    const col = ai % 2;
    const gr = Math.floor(ai / 2);
    const bx = PAD + col * (boxW + GRID_GAP);
    const by = PAD + TITLE_H + 18 + gridRowH.slice(0, gr).reduce((x, y) => x + y + GRID_GAP, 0);

    ctx.fillStyle = "#f8f9fa";
    roundRectPath(ctx, bx, by, boxW, gridRowH[gr], 12);
    ctx.fill();

    // 소속사 로고 (비율 유지, 칸 안에 맞춤)
    const logo = logos[ai];
    const innerW = boxW - BOX_PAD * 2;
    if (logo && logo.naturalWidth && logo.naturalHeight) {
      const sc = Math.min(LOGO_H / logo.naturalHeight, innerW / logo.naturalWidth);
      const dw = logo.naturalWidth * sc;
      const dh = logo.naturalHeight * sc;
      ctx.drawImage(logo, bx + boxW / 2 - dw / 2, by + BOX_PAD + (LOGO_H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = "#444444";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(agency.name, bx + boxW / 2, by + BOX_PAD + LOGO_H / 2, innerW);
    }

    agency.groups.forEach((g, gi) => {
      const pc = gi % 2;
      const pr = Math.floor(gi / 2);
      const cx = bx + BOX_PAD + pc * (colW + PICK_GAP) + colW / 2;
      const ry =
        by + BOX_PAD + LOGO_H + 10 + rowHeights[ai].slice(0, pr).reduce((x, y) => x + y + PICK_GAP, 0);
      const sx = cx - SLOT / 2;

      // 사진 칸 (둥근 모서리, 가운데 기준 정사각형으로 채움)
      ctx.save();
      roundRectPath(ctx, sx, ry, SLOT, SLOT, 10);
      ctx.clip();
      ctx.fillStyle = "#e9ecef";
      ctx.fillRect(sx, ry, SLOT, SLOT);
      const im = pickImgs[ai][gi];
      if (im && im.naturalWidth && im.naturalHeight) {
        const side = Math.min(im.naturalWidth, im.naturalHeight);
        ctx.drawImage(
          im,
          (im.naturalWidth - side) / 2,
          (im.naturalHeight - side) / 2,
          side,
          side,
          sx,
          ry,
          SLOT,
          SLOT
        );
      } else {
        ctx.fillStyle = "#adb5bd";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("?", cx, ry + SLOT / 2);
      }
      ctx.restore();

      // 이름 / 유닛
      const lines = pickLines[ai][gi];
      ctx.fillStyle = "#444444";
      ctx.font = NAME_FONT;
      lines.forEach((ln, k) => ctx.fillText(ln, cx, ry + SLOT + 5 + NAME_LH * (k + 0.5)));
      ctx.fillStyle = "#999999";
      ctx.font = "10.4px sans-serif";
      ctx.fillText(g.name, cx, ry + SLOT + 5 + lines.length * NAME_LH + UNIT_H / 2, colW);
    });
  });

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 실패"))), "image/png")
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 방법으로 재시도 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function triggerDownload(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export default function App() {
  // 인증(익명) — 공유(저장)할 때만 필요합니다. 실패해도 선택/이미지 저장은 가능
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  const [nickname, setNickname] = useState(() => loadLocalNickname());
  const [picks, setPicks] = useState<Picks>(() => loadLocalPicks());

  const [roomId, setRoomId] = useState<string | null>(() => parseRoomId());
  const [roomUsers, setRoomUsers] = useState<RoomUsers>({});
  const [roomLoaded, setRoomLoaded] = useState<boolean>(() => !parseRoomId());
  const [roomError, setRoomError] = useState(false);

  const [showResult, setShowResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agencies, setAgencies] = useState<Agency[]>([]);

  const [preview, setPreview] = useState<{ src: string; blob: Blob; name: string } | null>(null); // 다운로드가 안 되는 환경용 안내 창
  const [savingImage, setSavingImage] = useState(false);
  const transferApplied = useRef(false);
  const [serverBusy, setServerBusy] = useState<boolean>(() => isServerBusyNow());
  const lastSubmitAt = useRef(0);
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
  const [roomSource, setRoomSource] = useState<"main" | "legacy">("main"); // legacy = 이전 서버(읽기 전용)
  const [roomFetchedAt, setRoomFetchedAt] = useState<number | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomStale, setRoomStale] = useState(false); // 서버를 못 읽어서 저장된 결과를 보여주는 중
  const [roomRefreshTick, setRoomRefreshTick] = useState(0);
  const forceRefresh = useRef(false);
  const roomReq = useRef(0);
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

  // 앱 안 브라우저에서 '기본 브라우저로 열기'로 넘어온 경우: 주소에 실린 선택·닉네임을 이어받음
  useEffect(() => {
    if (agencies.length === 0 || transferApplied.current) return;
    transferApplied.current = true;
    const sp = new URLSearchParams(window.location.search);
    const code = sp.get("pk");
    if (code === null) return;
    const next: Picks = {};
    let i = 0;
    agencies.forEach((a) =>
      a.groups.forEach((g) => {
        const ch = code.charAt(i++);
        const idx = ch && ch !== "-" ? parseInt(ch, 36) : NaN;
        const m = Number.isNaN(idx) ? undefined : g.members[idx];
        if (m) next[g.id] = m.id;
      })
    );
    if (Object.keys(next).length > 0) setPicks(next);
    const nk = sp.get("nk");
    if (nk) setNickname(nk.slice(0, MAX_NICKNAME_LENGTH));
    sp.delete("pk");
    sp.delete("nk");
    const qs = sp.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [agencies]);

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

  // ── 방 불러오기: 이 기기에 저장된 결과가 있으면 먼저 보여주고, 오래됐을 때만 서버를 읽음
  useEffect(() => {
    if (!roomId) return;
    const myReq = ++roomReq.current;
    const isLatest = () => roomReq.current === myReq;
    const force = forceRefresh.current;
    forceRefresh.current = false;

    const apply = (d: RoomData) => {
      setRoomUsers(d.users);
      setRoomName(d.name);
      setRoomOwner(d.ownerUid);
      setRoomSource(d.source);
      setRoomFetchedAt(d.at);
      setRoomMetaLoaded(true);
      setRoomError(false);
      setRoomLoaded(true);
    };

    (async () => {
      const cached = loadRoomCache(roomId);
      if (cached) apply(cached);
      if (!uid) {
        // 아직 로그인 전이거나 서버에 연결할 수 없는 상태: 저장된 결과가 있으면 그걸로 보여줌
        if (authError) {
          if (cached) setRoomStale(true);
          else setRoomError(true);
          setRoomLoaded(true);
        }
        return;
      }
      if (cached && !force && Date.now() - cached.at < ROOM_CACHE_TTL_MS) {
        setRoomStale(false);
        setRoomLoading(false);
        return; // 방금 본 방이면 서버를 읽지 않음
      }
      setRoomLoading(true);
      try {
        const fresh = await fetchRoom(roomId);
        if (!isLatest()) return;
        apply(fresh);
        setRoomStale(false);
        if (Object.keys(fresh.users).length > 0) saveRoomCache(roomId, fresh);
      } catch (err) {
        if (!isLatest()) return;
        console.warn("방 불러오기 실패:", err);
        if (cached) {
          setRoomStale(true); // 저장된 결과를 대신 보여줌
        } else {
          setRoomError(true);
        }
        setRoomLoaded(true);
      } finally {
        if (isLatest()) setRoomLoading(false);
      }
    })();
  }, [roomId, uid, authError, roomRefreshTick]);

  // 결과표를 서버에서 다시 읽기 (실시간 연결 대신 사용)
  const refreshRoom = () => {
    if (!roomId || roomLoading) return;
    if (roomFetchedAt && Date.now() - roomFetchedAt < REFRESH_COOLDOWN_MS) {
      alert("방금 불러온 결과예요. 1분 뒤에 다시 새로고침할 수 있어요.");
      return;
    }
    forceRefresh.current = true;
    setRoomRefreshTick((t) => t + 1);
  };

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
    // 선택지가 1명뿐인 유닛은 무조건 일치하므로 일치율 계산에서 제외
  const matchGroupIds = useMemo(() => {
    const ids = new Set<string>();
    agencies.forEach((a) => a.groups.forEach((g) => { if (g.members.length > 1) ids.add(g.id); }));
    return ids;
  }, [agencies]);

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
  return computeMatches(roomUsers[baseUserId].picks, roomUsers, Array.from(matchGroupIds)); // ← validGroupIds에서 변경
}, [baseUserId, roomUsers, matchGroupIds]); // ← 의존성도 변경
  
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

  // 내 선택/닉네임이 바뀔 때마다 이 기기에 저장
  useEffect(() => {
    saveLocal(PICKS_KEY, JSON.stringify(picks));
  }, [picks]);
  useEffect(() => {
    saveLocal(NICK_KEY, nickname);
  }, [nickname]);

  // CSV가 바뀌어 없어진 멤버/유닛이 저장돼 있으면 정리
  useEffect(() => {
    if (agencies.length === 0) return;
    setPicks((cur) => {
      const next: Picks = {};
      let changed = false;
      Object.entries(cur).forEach(([g, m]) => {
        if (validGroupIds.has(g) && memberMap[m]?.groupId === g) next[g] = m;
        else changed = true;
      });
      return changed ? next : cur;
    });
  }, [agencies, validGroupIds, memberMap]);

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
    if (isServerBusyNow()) return; // ← 추가: 서버가 혼잡하면 통계는 건너뜀
    const clean: Picks = {};
    Object.entries(finalPicks).forEach(([g, m]) => {
      if (validGroupIds.has(g)) clean[g] = m;
    });
    if (!shouldSendStats()) return;
    // 마지막으로 보낸 내용과 같으면 건너뜀 (이미지를 여러 번 저장해도 서버 쓰기는 한 번)
    const signature = JSON.stringify(Object.keys(clean).sort().map((k) => [k, clean[k]]));
    try {
      if (window.localStorage.getItem("es_stats_sig") === signature) return;
    } catch {
      /* 무시 */
    }
    setDoc(doc(db, "stats", getStatsId()), { picks: clean, day: todayUtc(), v: 2, lang: STATS_LANG })
  .then(() => saveLocal("es_stats_sig", signature))
  .catch((err) => console.warn("익명 통계 저장 실패(무시):", err));
  };

  // 만들어진 이미지를 저장. 다운로드가 막힌 환경(앱 안 브라우저 등)이면 안내 창을 띄움
  const deliverBlob = async (blob: Blob, filename: string) => {
    if (!IN_APP_BROWSER.test(navigator.userAgent) && triggerDownload(blob, filename)) return;
    setPreview({ src: await blobToDataUrl(blob), blob, name: filename });
  };

  // 이미지 만들기 → 저장. 만드는 동안 버튼을 잠그고, 너무 오래 걸리면 중단해서 '반응 없음'이 없게 함
  const runSave = async (make: () => Promise<Blob>, filename: string, timeoutMs: number) => {
    if (savingImage) return;
    setSavingImage(true);
    try {
      const blob = await withTimeout(make(), timeoutMs);
      await deliverBlob(blob, filename);
    } finally {
      setSavingImage(false);
    }
  };

  // 앱 안 브라우저 → 기본 브라우저로 넘길 때, 지금 고른 선택이 이어지도록 주소에 실어 보냄
  const buildTransferUrl = () => {
    const code = agencies
      .flatMap((a) => a.groups)
      .map((g) => {
        const idx = g.members.findIndex((m) => m.id === picks[g.id]);
        return idx >= 0 ? idx.toString(36) : "-";
      })
      .join("");
    const u = new URL(window.location.href);
    u.hash = "";
    u.searchParams.set("pk", code);
    if (trimmedName) u.searchParams.set("nk", trimmedName);
    return u.toString();
  };

  const openExternal = () => {
    const url = buildTransferUrl();
    const ua = navigator.userAgent;
    if (/KAKAOTALK/i.test(ua)) {
      window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    } else if (/Android/i.test(ua)) {
      window.location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
    } else {
      alert("화면 모서리의 ⋯ 메뉴에서 '다른 브라우저로 열기'(또는 'Safari로 열기')를 눌러주세요.\n안 보이면 '주소 복사'를 눌러 Chrome·Safari에 붙여 넣으세요.");
    }
  };

  const copyTransferUrl = async () => {
    const ok = await copyText(buildTransferUrl());
    alert(
      ok
        ? "주소를 복사했어요. Chrome·Safari 주소창에 붙여 넣으면 지금 고른 선택이 그대로 이어져요."
        : "복사에 실패했습니다."
    );
  };

  const sharePreview = async () => {
    if (!preview) return;
    try {
      await navigator.share({ files: [new File([preview.blob], preview.name, { type: "image/png" })] });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") alert("공유 창을 열지 못했어요. 다른 방법을 사용해 주세요.");
    }
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
    try {
      await runSave(
        () => renderPersonalBlob(agencies, picks, memberMap, trimmedName ? `${trimmedName}의 취향표` : "나의 취향표"),
        `${safeFileName(trimmedName || "my")}_picks.png`,
        30000
      );
    } catch (err) {
      console.error("이미지 저장 에러:", err);
      alert("이미지 저장에 실패했습니다. 잠시 후 다시 시도하거나 Chrome·Safari 같은 기본 브라우저에서 열어주세요.");
      return;
    }
    // 통계 전송은 이미지 저장이 끝난 뒤, 실패해도 저장에 영향이 없도록 따로 처리
    try {
      sendAnonymousStats(picks);
    } catch {
      /* 무시 */
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
    if (isServerBusyNow()) {
      setServerBusy(true);
      alert(SERVER_BUSY_MSG);
      return;
    }
    if (!uid) {
      alert(authError ? SERVER_BUSY_MSG : "서버에 연결 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (roomId && !roomLoaded) {
      alert("방 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (roomId && roomSource === "legacy") {
      alert("이전 서버에서 만든 방이라 보기만 가능해요. 새로 제출하려면 '새 방 만들기'를 눌러주세요.");
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

      // 이미 같은 내용으로 제출돼 있으면 서버에 쓰지 않음 (쓰기 절약)
      const mineNow = roomId ? roomUsers[uid] : undefined;
      if (mineNow && mineNow.nickname === trimmedName && samePicks(mineNow.picks, cleanPicks)) {
        setShowResult(true);
        return;
      }
      if (Date.now() - lastSubmitAt.current < SUBMIT_COOLDOWN_MS) {
        alert("방금 제출했어요. 잠시 후 다시 눌러주세요.");
        return;
      }

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
        await withTimeout(batch.commit(), 12000);
      } else {
        await withTimeout(setDoc(userRef, userData), 12000);
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

      lastSubmitAt.current = Date.now();

      // 제출 직후에는 방 전체(참여자 수만큼)를 다시 읽지 않고 '내 문서 1건'만 읽어 화면과 저장본에 반영 (읽기 절약)
      let saved: UserDoc | null = null;
      try {
        const snap = await withTimeout(getDocFromServer(userRef), 8000);
        saved = snap.exists() ? parseUserDoc(snap.data()) : null;
      } catch {
        saved = null;
      }
      if (saved && saved.joinedTs) {
        const now = Date.now();
        const nextData: RoomData = {
          source: "main",
          at: creating ? now : roomFetchedAt ?? now, // 기존 방은 '마지막으로 서버에서 읽은 시각'을 유지
          name: creating ? newRoomName : roomName,
          ownerUid: creating ? uid : roomOwner,
          users: { ...(creating ? {} : roomUsers), [uid]: saved }
        };
        saveRoomCache(rid, nextData);
        setRoomUsers(nextData.users);
        setRoomName(nextData.name);
        setRoomOwner(nextData.ownerUid);
        setRoomSource("main");
        setRoomFetchedAt(nextData.at);
        setRoomMetaLoaded(true);
        setRoomError(false);
        setRoomLoaded(true);
        setRoomStale(false);
        if (creating) {
          window.history.replaceState({}, "", `?room=${rid}`);
          setRoomId(rid);
        }
      } else {
        // 내 문서를 못 읽었을 때만 예전처럼 방 전체를 다시 읽음
        forceRefresh.current = true;
        if (!roomId) {
          window.history.replaceState({}, "", `?room=${rid}`);
          setRoomId(rid);
        } else {
          setRoomRefreshTick((t) => t + 1);
        }
      }
      setNickname(trimmedName);
      setShowResult(true);
    } catch (err) {
      console.error("제출 에러:", (err as { code?: string })?.code, err);
      if (isServerBusyError(err)) {
        markServerBusy();
        setServerBusy(true);
        alert(SERVER_BUSY_MSG);
      } else {
        alert("저장 중 오류가 발생했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
      }
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
    setRoomSource("main");
    setRoomFetchedAt(null);
    setRoomStale(false);
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
    setRoomSource("main");
    setRoomFetchedAt(null);
    setRoomStale(false);
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
    const newName = input.trim().slice(0, MAX_ROOM_NAME);
    try {
      await withTimeout(updateDoc(doc(db, "rooms", roomId), { name: newName }), 12000);
      // 서버 저장이 끝나면 화면과 이 기기의 저장본에도 바로 반영
      setRoomName(newName);
      saveRoomCache(roomId, {
        source: "main",
        at: roomFetchedAt ?? Date.now(),
        name: newName,
        ownerUid: roomOwner,
        users: roomUsers
      });
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
      await runSave(() => renderToBlob(target, true), "multi_picks.png", 60000);
    } catch (err) {
      console.error("이미지 저장 에러:", err);
      alert("이미지 저장에 실패했습니다. 잠시 후 다시 시도하거나 Chrome·Safari 같은 기본 브라우저에서 열어주세요.");
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
          <h1>앙스타 유닛별 취향표</h1>
          <p className="subtitle">유닛마다 한 명씩, 총 {totalGroups}명을 골라주세요</p>
          <p className="progress">
            {pickedCount} / {totalGroups}
            {pickedCount > 0 && (
              <button
                type="button"
                className="reset-btn"
                onClick={() => {
                  if (window.confirm("고른 선택을 모두 지우고 처음부터 다시 할까요?")) setPicks({});
                }}
              >
                초기화
              </button>
            )}
          </p>

          {roomId && (
            <div className="room-banner">
              <span>
                {roomError
                  ? "방 정보를 불러오지 못했습니다. 링크가 틀렸거나 현재 서버가 혼잡할 수 있어요. 잠시 후 다시 시도해주세요."
                  : roomLoaded
                  ? `${roomSource === "legacy" ? "이전 서버의 방(보기 전용)" : "공유된 방에 참여 중"}${
                      roomName ? ` · ${roomName}` : ""
                    } · 참여자 ${displayUsers.length}명`
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
                  {trimmedName ? `${trimmedName}의 취향표` : "나의 취향표"}
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
                placeholder="예: 보리"
              />
            </div>
            <p className="hint">
              닉네임을 쓰면 이미지에 “닉네임의 취향표”로 들어가요. 이미지 저장은 비워둬도 되고,
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
                    placeholder="예: 우리 모임 취향표 (선택)"
                  />
                </div>
                <p className="hint">
                  공유 링크를 만들 때만 정할 수 있어요. 결과표 이미지에 “방이름의 결과”로 표시되고,
                  방을 만든 사람만 나중에 바꿀 수 있어요.
                </p>
              </>
            )}

            <div className="finish-buttons">
              <button
                className="download-btn"
                onClick={savePersonalImage}
                disabled={savingImage}
                style={{ backgroundColor: "#20c997" }}
              >
                {savingImage ? "이미지 만드는 중..." : "내 선택 이미지 저장"}
              </button>
              <button className="download-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "저장 중..." : roomId ? "이 방에 제출하기" : "공유 링크 만들기"}
              </button>
            </div>
            {STATS_SAMPLE_RATE > 0 && (
              <p className="hint">
                완성한 선택은 닉네임·방 정보 없이 <b>익명 통계</b>에 반영될 수 있어요.
              </p>
            )}
            {serverBusy && (
              <p className="hint busy-note">
                현재 서버가 혼잡하여 공유 링크 만들기·제출이 어려워요. 내 선택 이미지 저장은 가능해요.
              </p>
            )}
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
              방 정보를 불러오지 못했습니다. 링크가 틀렸거나 현재 서버가 혼잡할 수 있어요. 잠시 후 다시 시도해주세요.
            </p>
          )}
          <div className="result-buttons">
            <button className="download-btn" onClick={copyLink} style={{ backgroundColor: "#4dabf7" }}>
              공유 링크 복사
            </button>
            <button className="download-btn" onClick={() => setShowResult(false)}>
              {myResultExists ? "내 픽 수정하기" : "내 픽 고르기"}
            </button>
            <button
              className="download-btn"
              onClick={saveBoardImage}
              disabled={savingImage}
              style={{ backgroundColor: "#20c997" }}
            >
              {savingImage ? "이미지 만드는 중..." : "결과표 이미지 저장"}
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

          <div className="room-status">
            {roomFetchedAt && (
              <span>
                {new Date(roomFetchedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}에 불러온 결과
              </span>
            )}
            <button type="button" className="link-btn" onClick={refreshRoom} disabled={roomLoading}>
              {roomLoading ? "불러오는 중..." : "새로고침"}
            </button>
            {roomSource === "legacy" && <span className="status-note">이전 서버의 방이라 보기만 가능해요</span>}
            {roomStale && (
              <span className="status-note">서버에서 새로 읽지 못해 이 기기에 저장된 결과를 보여주고 있어요</span>
            )}
            {displayUsers.length >= MAX_USERS_PER_ROOM && (
              <span className="status-note">참여자가 많아 먼저 제출한 {MAX_USERS_PER_ROOM}명까지만 보여요</span>
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
              {roomName ? `${roomName}의 결과` : "참여자별 취향표"}
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
                          const same = matchOn && u.id !== baseUserId && matchGroupIds.has(g.id) && !!basePick && basePick === u.picks[g.id];
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

      {preview && (
        <div className="img-preview-overlay" onClick={() => setPreview(null)}>
          <div className="img-preview-box" onClick={(e) => e.stopPropagation()}>
            <p className="preview-guide">
              이 브라우저에서는 이미지를 바로 저장할 수 없어요.
              <br />
              아래 방법 중 하나를 사용해 주세요.
            </p>
            <div className="preview-actions">
              {typeof navigator.canShare === "function" &&
                navigator.canShare({ files: [new File([preview.blob], preview.name, { type: "image/png" })] }) && (
                  <button type="button" className="download-btn" onClick={sharePreview}>
                    이미지 저장·공유
                  </button>
                )}
              <button type="button" className="download-btn" onClick={openExternal}>
                기본 브라우저로 열기
              </button>
              <button type="button" className="download-btn" onClick={copyTransferUrl}>
                주소 복사
              </button>
            </div>
            <img src={preview.src} alt="저장할 이미지" />
            <p className="preview-sub">이미지를 길게 눌러 저장 메뉴가 나오면 그대로 저장해도 돼요.</p>
            <button type="button" className="download-btn" onClick={() => setPreview(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
