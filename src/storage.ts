import { signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp
} from "firebase/firestore";
import type { DocumentData, Firestore } from "firebase/firestore";
import { db, legacyAuth, legacyDb } from "./firebaseClient";
import type { Lang } from "./i18n";
import {
  ID_ALIASES,
  MAX_NICKNAME_LENGTH,
  MAX_USERS_PER_ROOM,
  MY_ROOMS_KEY,
  MY_ROOMS_MAX,
  NICK_KEY,
  PICKS_KEY,
  ROOM_CACHE_INDEX,
  ROOM_CACHE_KEEP,
  ROOM_CACHE_PREFIX,
  ROOM_ID_PATTERN,
  SERVER_BUSY_KEY,
  SERVER_BUSY_MS,
  STATS_ID_KEY,
  STATS_SAMPLE_KEY,
  STATS_SAMPLE_RATE
} from "./types";
import type { MyRoom, Picks, RoomData, RoomUsers, UserDoc } from "./types";
import { generateRoomId, todayUtc } from "./utils";

// ───────────────────────── 참여자 문서 파싱 ─────────────────────────
export function parseUserDoc(data: DocumentData): UserDoc | null {
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

// ───────────────────────── 방 불러오기 및 캐시 (서버 읽기 절약) ─────────────────────────
export function saveRoomCache(rid: string, d: RoomData) {
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

export function loadRoomCache(rid: string): RoomData | null {
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

export async function fetchRoomFrom(dbx: Firestore, rid: string, source: "main" | "legacy"): Promise<RoomData> {
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

export async function fetchRoom(rid: string): Promise<RoomData> {
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

// ───────────────────────── 로컬 저장소 (내 방 목록 / 픽 / 닉네임) ─────────────────────────
export function saveLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 저장소를 못 쓰는 환경이면 이번 접속에서만 유지 */
  }
}

export function loadMyRooms(): MyRoom[] {
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

export function saveMyRooms(list: MyRoom[]) {
  try {
    window.localStorage.setItem(MY_ROOMS_KEY, JSON.stringify(list));
  } catch {
    /* 저장소를 못 쓰는 환경이면 이번 접속에서만 유지 */
  }
}

export function loadLocalPicks(): Picks {
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

export function loadLocalNickname(): string {
  try {
    return (window.localStorage.getItem(NICK_KEY) || "").slice(0, MAX_NICKNAME_LENGTH);
  } catch {
    return "";
  }
}

// ───────────────────────── 서버 혼잡(무료 한도 초과 등) 처리 ─────────────────────────
export function isServerBusyError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === "resource-exhausted" ||
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    (err as Error)?.message === "timeout"
  );
}

export function isServerBusyNow(): boolean {
  try {
    return Number(window.localStorage.getItem(SERVER_BUSY_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

export function markServerBusy() {
  saveLocal(SERVER_BUSY_KEY, String(Date.now() + SERVER_BUSY_MS));
}

// ───────────────────────── 익명 통계 ─────────────────────────
// 닉네임·로그인 id·방 번호는 저장하지 않고, 유닛별로 고른 멤버와 '날짜'만 저장합니다.
// 같은 기기에서 다시 제출하면 같은 문서를 덮어쓰도록, 로그인과 무관한 임의 번호를 이 브라우저에 보관합니다.
let memoryStatsId: string | null = null;

export function getStatsId(): string {
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

export function shouldSendStats(): boolean {
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

// 완성된 선택을 익명 통계로 보냄 (실패해도 사용자에게는 영향 없음)
export function sendAnonymousStats(
  finalPicks: Picks,
  uid: string | null,
  validGroupIds: Set<string>,
  lang: Lang
) {
  if (!uid) return; // 인증 전이면 건너뜀
  if (isServerBusyNow()) return; // 서버가 혼잡하면 통계는 건너뜀
  const clean: Picks = {};
  Object.entries(finalPicks).forEach(([g, m]) => {
    if (validGroupIds.has(g)) clean[g] = m;
  });
  if (Object.keys(clean).length === 0) return;
  if (!shouldSendStats()) return;
  // 마지막으로 보낸 내용(픽 + 언어)과 같으면 건너뜀 (이미지를 여러 번 저장해도 서버 쓰기는 한 번)
  const signature = JSON.stringify([Object.keys(clean).sort().map((k) => [k, clean[k]]), lang]);
  try {
    if (window.localStorage.getItem("es_stats_sig") === signature) return;
  } catch {
    /* 무시 */
  }
  setDoc(doc(db, "stats", getStatsId()), { picks: clean, day: todayUtc(), v: 2, lang })
    .then(() => saveLocal("es_stats_sig", signature))
    .catch((err) => console.warn("익명 통계 저장 실패(무시):", err));
}
