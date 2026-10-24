import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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

export const app = initializeApp(firebaseConfig);

// 로컬 개발(yarn start)에서는 디버그 토큰 사용 (배포된 사이트에는 영향 없음)
if (process.env.NODE_ENV !== "production") {
  (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider("6Lf-X-stAAAAAFh0ZxaXocD47hQkQ0q43GByaQ-L"),
  isTokenAutoRefreshEnabled: true
});

export const db = getFirestore(app);
export const auth = getAuth(app);

// 다른 서버를 '읽기 전용'으로 함께 쓰고 싶을 때만 위와 같은 형식의 값을 여기에 채우세요.
// (예: 서버를 옮긴 뒤에도 예전 방을 계속 보여주고 싶을 때) 지금은 사용하지 않음(null).
const legacyFirebaseConfig: typeof firebaseConfig | null = null;
const legacyApp = legacyFirebaseConfig ? initializeApp(legacyFirebaseConfig, "legacy") : null;
export const legacyDb = legacyApp ? getFirestore(legacyApp) : null;
export const legacyAuth = legacyApp ? getAuth(legacyApp) : null;
