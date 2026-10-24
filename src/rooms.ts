// 공유 방 데이터: 방 ID, 서버에서 읽기, 이 기기 캐시
import type { DocumentData, Firestore } from "firebase/firestore";
import {
  ID_ALIASES, MAX_NICKNAME_LENGTH, MAX_USERS_PER_ROOM, ROOM_CACHE_INDEX, ROOM_CACHE_KEEP,
  ROOM_CACHE_PREFIX, ROOM_ID_PATTERN
} from "./config";
import type { Picks, RoomData, RoomUsers, UserDoc } from "./types";
import { PICK_SHEETS, sheetLocalKey, type PickSheetId } from "./pickSheets";
import { Timestamp, collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db, legacyAuth, legacyDb } from "./firebaseClient";
import { signInAnonymously } from "firebase/auth";

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

export function saveRoomCache(rid: string, d: RoomData, sheet: PickSheetId = "current") {
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
      sheetLocalKey(ROOM_CACHE_PREFIX, sheet) + rid,
      JSON.stringify({ source: d.source, at: d.at, name: d.name, ownerUid: d.ownerUid, users })
    );
    let index: string[] = [];
    try {
      index = JSON.parse(window.localStorage.getItem(sheetLocalKey(ROOM_CACHE_INDEX, sheet)) || "[]");
    } catch {
      index = [];
    }
    index = [rid, ...index.filter((x) => x !== rid)];
    index.slice(ROOM_CACHE_KEEP).forEach((old) => window.localStorage.removeItem(sheetLocalKey(ROOM_CACHE_PREFIX, sheet) + old));
    window.localStorage.setItem(sheetLocalKey(ROOM_CACHE_INDEX, sheet), JSON.stringify(index.slice(0, ROOM_CACHE_KEEP)));
  } catch {
    /* 저장 공간이 부족하거나 쓸 수 없으면 캐시만 건너뜀 */
  }
}

export function loadRoomCache(rid: string, sheet: PickSheetId = "current"): RoomData | null {
  try {
    const raw = window.localStorage.getItem(sheetLocalKey(ROOM_CACHE_PREFIX, sheet) + rid);
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

async function fetchRoomFrom(dbx: Firestore, rid: string, source: "main" | "legacy", collectionName: string): Promise<RoomData> {
  const [meta, snap] = await Promise.all([
    getDoc(doc(dbx, collectionName, rid)),
    getDocs(
      query(collection(dbx, collectionName, rid, "users"), orderBy("joinedAt"), limit(MAX_USERS_PER_ROOM))
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

export async function fetchRoom(rid: string, sheet: PickSheetId = "current"): Promise<RoomData> {
  const main = await fetchRoomFrom(db, rid, "main", PICK_SHEETS[sheet].collection);
  if (Object.keys(main.users).length > 0) return main;
  // 새 서버에 없는 방이면 이전 서버(읽기 전용)에서 찾아봄 (이전 서버를 설정한 경우에만)
  if (sheet !== "current" || !legacyDb || !legacyAuth) return main;
  try {
    await legacyAuth.authStateReady();
    if (!legacyAuth.currentUser) await signInAnonymously(legacyAuth);
    const legacy = await fetchRoomFrom(legacyDb, rid, "legacy", "rooms");
    if (Object.keys(legacy.users).length > 0) return legacy;
  } catch (err) {
    console.warn("이전 서버 조회 실패:", err);
  }
  return main;
}

export function parseRoomId(): string | null {
  const v = new URLSearchParams(window.location.search).get("room");
  return v && ROOM_ID_PATTERN.test(v) ? v : null; // 이상한 값(예: a/b)은 무시
}

export function generateRoomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

// 새 방 생성 요청이 시간 초과되더라도 같은 ID로 확인/재시도해 중복 방 생성을 방지
// 실제 저장에 성공했는지 확인하기 전까지 마지막 생성 시도의 ID를 기기에 남긴다.
const PENDING_ROOM_KEY = "es_pending_room_v1";
let pendingInMemory: { uid: string; signature: string; rid: string; sheet: PickSheetId } | null = null;

export function getPendingCreateRoom(uid: string, signature: string, sheet: PickSheetId = "current"): { rid: string; reused: boolean } {
  try {
    const raw = window.localStorage.getItem(sheetLocalKey(PENDING_ROOM_KEY, sheet));
    if (raw) {
      const previous = JSON.parse(raw);
      if (previous?.uid === uid && previous?.signature === signature &&
          typeof previous?.rid === "string" && ROOM_ID_PATTERN.test(previous.rid)) {
        return { rid: previous.rid, reused: true };
      }
    }
  } catch {
    if (pendingInMemory?.uid === uid && pendingInMemory.sheet === sheet && pendingInMemory.signature === signature) {
      return { rid: pendingInMemory.rid, reused: true };
    }
  }
  const rid = generateRoomId();
  const pending = { uid, signature, rid, sheet };
  pendingInMemory = pending;
  try {
    window.localStorage.setItem(sheetLocalKey(PENDING_ROOM_KEY, sheet), JSON.stringify(pending));
  } catch {
    // 로컬 저장소를 사용할 수 없으면 같은 탭에서만 ID를 재사용
  }
  return { rid, reused: false };
}

export function clearPendingCreateRoom(rid: string, sheet: PickSheetId = "current"): void {
  if (pendingInMemory?.rid === rid && pendingInMemory.sheet === sheet) pendingInMemory = null;
  try {
    const raw = window.localStorage.getItem(sheetLocalKey(PENDING_ROOM_KEY, sheet));
    if (raw && JSON.parse(raw)?.rid === rid) window.localStorage.removeItem(sheetLocalKey(PENDING_ROOM_KEY, sheet));
  } catch {
    // localStorage 사용 불가
  }
}
