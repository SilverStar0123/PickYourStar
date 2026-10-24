// 익명 통계 전송
import type { Lang } from "./i18n";
import type { Picks } from "./types";
import { STATS_ID_KEY, STATS_SAMPLE_KEY, STATS_SAMPLE_RATE } from "./config";
import { db } from "./firebaseClient";
import { doc, setDoc } from "firebase/firestore";
import { generateRoomId } from "./rooms";
import { isServerBusyNow } from "./serverStatus";
import { saveLocal } from "./storage";
import { todayUtc } from "./utils";

// 닉네임·로그인 id·방 번호는 저장하지 않고, 유닛별로 고른 멤버와 '날짜'만 저장합니다.
// 같은 기기에서 다시 제출하면 같은 문서를 덮어쓰도록, 로그인과 무관한 임의 번호를 이 브라우저에 보관합니다.
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
  // 마지막으로 보낸 픽과 같으면 건너뜀 (이미지를 여러 번 저장하거나 언어만 바꿔도 서버 쓰기는 한 번)
  const signature = JSON.stringify(Object.keys(clean).sort().map((k) => [k, clean[k]]));
  try {
    if (window.localStorage.getItem("es_stats_sig") === signature) return;
  } catch {
    /* 무시 */
  }
  setDoc(doc(db, "stats", getStatsId()), { picks: clean, day: todayUtc(), v: 2, lang })
    .then(() => saveLocal("es_stats_sig", signature))
    .catch((err) => console.warn("익명 통계 저장 실패(무시):", err));
}
