// 오류별 재시도 간격: 일시적인 네트워크 장애까지 10분간 막지 않도록 분리
import {
  DEADLINE_RETRY_MS, QUOTA_RETRY_MS, SERVER_BUSY_KEY, UNAVAILABLE_RETRY_MS
} from "./config";
import { saveLocal } from "./storage";

export type ServerErrorKind = "quota" | "unavailable" | "deadline" | "timeout" | "other";

export function getServerErrorKind(err: unknown): ServerErrorKind {
  const code = (err as { code?: string } | null)?.code;
  if (code === "resource-exhausted") return "quota";
  if (code === "unavailable") return "unavailable";
  if (code === "deadline-exceeded") return "deadline";
  if ((err as { message?: string } | null)?.message === "timeout") return "timeout";
  return "other";
}

export function isServerBusyError(err: unknown): boolean {
  return getServerErrorKind(err) !== "other";
}

export function retryDelayMs(kind: ServerErrorKind): number {
  if (kind === "quota") return QUOTA_RETRY_MS;
  if (kind === "unavailable") return UNAVAILABLE_RETRY_MS;
  if (kind === "deadline") return DEADLINE_RETRY_MS;
  return 0; // 타임아웃·권한 오류·기타 오류는 자동 차단하지 않음
}

export function serverBusyRemainingMs(): number {
  try {
    return Math.max(0, Number(window.localStorage.getItem(SERVER_BUSY_KEY) || 0) - Date.now()) || 0;
  } catch {
    return 0;
  }
}

export function isServerBusyNow(): boolean {
  return serverBusyRemainingMs() > 0;
}

export function markServerBusy(err: unknown): number {
  const delay = retryDelayMs(getServerErrorKind(err));
  if (delay > 0) saveLocal(SERVER_BUSY_KEY, String(Date.now() + delay));
  return delay;
}
