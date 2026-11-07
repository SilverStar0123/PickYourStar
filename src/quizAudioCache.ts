// Only the current question is downloaded. Blob playback never seeks over HTTP.
const CACHE = 'pickyourstar-quiz-audio-v1';
const TTL = 60 * 60 * 1000;
const DISK_LIMIT = 100 * 1024 * 1024;
const MEMORY_LIMIT = 40 * 1024 * 1024;
const FILE_LIMIT = 24 * 1024 * 1024;
const memory = new Map<string, { blob: Blob; expires: number }>();
let diskQueue: Promise<unknown> = Promise.resolve();
function diskJob<T>(job: () => Promise<T>): Promise<T> {
  const result = diskQueue.then(job, job);
  diskQueue = result.catch(() => undefined);
  return result;
}
function remember(key: string, blob: Blob, expires: number) {
  memory.delete(key);
  memory.set(key, { blob, expires });
  let bytes = 0;
  memory.forEach(entry => { bytes += entry.blob.size; });
  for (const oldest of Array.from(memory.keys())) {
    if (bytes <= MEMORY_LIMIT) break;
    bytes -= memory.get(oldest)!.blob.size;
    memory.delete(oldest);
  }
}
async function openCache(): Promise<Cache | null> {
  try { return await caches.open(CACHE); } catch { return null; }
}
export function forgetQuizAudio(url: string): void {
  const key = new URL(url, window.location.href).href;
  memory.delete(key);
  void diskJob(async () => { const cache = await openCache(); await cache?.delete(key); }).catch(() => undefined);
}
export async function loadQuizAudio(url: string, signal: AbortSignal): Promise<Blob> {
  const key = new URL(url, window.location.href).href;
  const check = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  check();
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) {
    remember(key, hit.blob, hit.expires);
    return hit.blob;
  }
  memory.delete(key);
  const stored = await diskJob(async () => {
    try {
      const cache = await openCache();
      const response = await cache?.match(key);
      if (!response) return null;
      const expires = Number(response.headers.get('x-quiz-expires'));
      if (expires <= Date.now() || !Number.isFinite(expires)) { await cache?.delete(key); return null; }
      const blob = await response.blob();
      if (!blob.size || blob.size > FILE_LIMIT) { await cache?.delete(key); return null; }
      return { blob, expires };
    } catch { return null; }
  });
  check();
  if (stored) { remember(key, stored.blob, stored.expires); return stored.blob; }
  const response = await fetch(key, { signal, credentials: 'omit' });
  if (!response.ok || response.status === 206) throw new Error('Audio download failed');
  const type = response.headers.get('content-type') || 'audio/mpeg';
  if (type.includes('text/') || type.includes('json')) throw new Error('Invalid audio response');
  if (Number(response.headers.get('content-length')) > FILE_LIMIT) throw new Error('Audio file too large');
  // Bound streaming responses too, even when Content-Length is absent.
  const reader = response.body?.getReader();
  let blob: Blob;
  if (reader) {
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      check();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > FILE_LIMIT) { await reader.cancel(); throw new Error('Audio file too large'); }
      parts.push(chunk.value);
    }
    blob = new Blob(parts, { type });
  } else { blob = await response.blob(); }
  check();
  if (!blob.size || blob.size > FILE_LIMIT) throw new Error('Invalid audio size');
  const expires = Date.now() + TTL;
  remember(key, blob, expires);
  // Disk caching is optional; blocked storage must not block playback.
  void diskJob(async () => {
    const cache = await openCache();
    if (!cache) return;
    let bytes = blob.size;
    const retained: { key: Request; bytes: number }[] = [];
    for (const request of await cache.keys()) {
      const entry = await cache.match(request);
      const size = Number(entry?.headers.get('x-quiz-bytes'));
      const expiry = Number(entry?.headers.get('x-quiz-expires'));
      if (request.url === key || !size || expiry <= Date.now()) { await cache.delete(request); continue; }
      bytes += size;
      retained.push({ key: request, bytes: size });
    }
    while ((bytes > DISK_LIMIT || retained.length >= 30) && retained.length) {
      const oldest = retained.shift()!;
      await cache.delete(oldest.key);
      bytes -= oldest.bytes;
    }
    await cache.put(key, new Response(blob, { headers: {
      'Content-Type': type, 'x-quiz-expires': String(expires), 'x-quiz-bytes': String(blob.size),
    } }));
  }).catch(() => undefined);
  return blob;
}
