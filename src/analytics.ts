// GA4 analytics: Firebase에 등록된 웹 측정 ID 사용. 별도 gtag.js 삽입 금지 (중복 수집 방지).
import { getAnalytics, isSupported, logEvent } from "firebase/analytics";
import type { Analytics } from "firebase/analytics";
import { app } from "./firebaseClient";

let analyticsPromise: Promise<Analytics | null> | null = null;

function getAnalyticsSafely(): Promise<Analytics | null> {
  if (process.env.NODE_ENV !== "production") return Promise.resolve(null);
  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => (supported ? getAnalytics(app) : null))
      .catch((err) => {
        console.warn("GA4 초기화 불가 (이용에는 영향 없음):", err);
        return null;
      });
  }
  return analyticsPromise;
}

/** 숫자·모드 구분만 전송. 닉네임, 이메일, 방 ID, UID는 절대 전송하지 않음. */
export function trackAnalyticsEvent(
  eventName: "service_view" | "pick_sheet_view" | "quiz_started" | "quiz_completed",
  params: Record<string, string | number>
): void {
  void getAnalyticsSafely().then((analytics) => {
    if (!analytics) return;
    try {
      logEvent(analytics, eventName, params);
    } catch (err) {
      console.warn("GA4 이벤트 기록 실패 (이용에는 영향 없음):", err);
    }
  });
}
