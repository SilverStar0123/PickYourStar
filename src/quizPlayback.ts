export type ClipMode = "random" | "start";

/** CSV start_min is seconds (including zero and fractional seconds). */
export function parseStartSeconds(value: string): number {
  const seconds = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(seconds) && seconds >= 0 ? seconds : 15;
}

export function chooseClipStart(
  song: { startMin: number; endMax: number }, mode: ClipMode,
  durationSec?: number, random = Math.random
): number {
  const min = Number.isFinite(song.startMin) ? Math.max(0, song.startMin) : 15;
  if (mode === "start") return min;
  const max = song.endMax > min + 5 ? song.endMax
    : durationSec && durationSec > min + 20 ? Math.floor(durationSec - 15) : 95;
  return min + Math.floor(random() * Math.max(1, max - min));
}

/** Keep CSV paths unchanged; route audio/ paths through the configured Worker. */
export function resolveQuizAudioUrl(value: string, baseUrl: string, publicUrl = "."): string | undefined {
  const path = value.trim();
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  const relative = path.replace(/^\.\//, "");
  if (baseUrl && relative.startsWith("audio/")) {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:") throw new Error("Audio baseUrl must use HTTPS");
    // CSV contains literal filenames. Escape #, %, spaces and Unicode per segment.
    return `${base.href.replace(/\/+$/, "")}/${relative.split("/").map(encodeURIComponent).join("/")}`;
  }
  return `${publicUrl}/${relative}`;
}
