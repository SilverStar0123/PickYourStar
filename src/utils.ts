import type React from "react";
import Papa from "papaparse";
import { LOCALE } from "./i18n";
import type { Lang } from "./i18n";
import { ITEM_GAP, ITEM_W, ROOM_ID_PATTERN } from "./types";
import type { Agency, NameMap, Picks } from "./types";

// ───────────────────────── 유틸 ─────────────────────────
// 외부 이미지 서비스(placeholder 등)에 의존하지 않도록 SVG를 직접 생성합니다.
// (이미지 저장(html2canvas) 시 CORS 문제도 생기지 않습니다.)
export const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string)
  );

export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function avatarUri(name: string): string {
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

export function badgeUri(text: string, w: number, h: number, multiline: boolean): string {
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
export function resolveAsset(path?: string): string | undefined {
  const p = (path || "").trim();
  if (!p) return undefined;
  if (/^(https?:|data:)/i.test(p)) return p;
  return `${process.env.PUBLIC_URL || "."}/${p.replace(/^\/+/, "")}`;
}

// CSV에 "eichi.webp"처럼 파일명만 적으면 지정 폴더(public/img/ 등)에서 찾고,
// "img/eichi.webp"나 "https://..." 처럼 경로/주소를 적으면 그대로 사용
export function resolveImg(value: string | undefined, dir: string): string | undefined {
  const v = (value || "").trim();
  if (!v) return undefined;
  if (/^(https?:|data:)/i.test(v) || v.includes("/")) return resolveAsset(v);
  return resolveAsset(`${dir}/${v}`);
}

// CSV 행의 키(BOM/공백/대소문자)와 값(따옴표)을 정리
export function cleanRow(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    out[key.replace(/^\uFEFF/, "").trim().toLowerCase()] = String(row[key] ?? "");
  }
  return out;
}

export const stripQuotes = (v: unknown) => String(v ?? "").replace(/['"]/g, "").trim();

// public 폴더의 CSV 파일을 읽어 (키가 정리된) 행 배열로 반환
export function loadCsv(file: string): Promise<Record<string, string>[]> {
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

export function onImgError(fallback: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const t = e.currentTarget;
    if (t.dataset.fallback !== "1") {
      t.dataset.fallback = "1";
      t.src = fallback;
    }
  };
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

// 한 줄에 다 안 들어가면 줄마다 인원을 고르게 나눔 (예: 5명 → 4+1 대신 3+2)
export function balancedMaxWidth(count: number, availWidth: number): number {
  const maxPerRow = Math.max(1, Math.floor((availWidth + ITEM_GAP) / (ITEM_W + ITEM_GAP)));
  const rows = Math.ceil(count / maxPerRow);
  const perRow = Math.ceil(count / rows);
  return perRow * ITEM_W + (perRow - 1) * ITEM_GAP;
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);

export const formatDate = (ms: number, lang: Lang) => new Date(ms).toLocaleDateString(LOCALE[lang]);

// 선택한 언어에 맞게 소속사·유닛·멤버의 표시 이름만 바꾼 목록을 만듦 (id·그룹 키는 그대로)
export function localizeAgencies(list: Agency[], lang: Lang): Agency[] {
  if (lang === "ko") return list;
  const pick = (base: string, names?: NameMap) =>
    (lang === "ja" ? names?.ja || names?.en : names?.[lang]) || base;
  return list.map((a) => ({
    ...a,
    name: pick(a.name, a.names),
    groups: a.groups.map((g) => ({
      ...g,
      name: pick(g.name, g.names),
      members: g.members.map((m) => ({ ...m, name: pick(m.name, m.names) }))
    }))
  }));
}

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
