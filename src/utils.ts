// 여러 곳에서 쓰는 작은 도우미 함수
import { ITEM_GAP, ITEM_W } from "./config";
import { LOCALE } from "./i18n";
import type { Lang } from "./i18n";
import type { Picks } from "./types";

// 한 줄에 다 안 들어가면 줄마다 인원을 고르게 나눔 (예: 5명 → 4+1 대신 3+2)
export function balancedMaxWidth(count: number, availWidth: number): number {
  const maxPerRow = Math.max(1, Math.floor((availWidth + ITEM_GAP) / (ITEM_W + ITEM_GAP)));
  const rows = Math.ceil(count / maxPerRow);
  const perRow = Math.ceil(count / rows);
  return perRow * ITEM_W + (perRow - 1) * ITEM_GAP;
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);

export const formatDate = (ms: number, lang: Lang) => new Date(ms).toLocaleDateString(LOCALE[lang]);

export function samePicks(a: Picks, b: Picks): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

// 서버가 응답하지 않을 때 '저장 중...'에서 영원히 멈추지 않도록
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "my";

export async function copyText(text: string): Promise<boolean> {
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
