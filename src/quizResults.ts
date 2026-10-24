// 최종 점수 1판 = Firestore quizScores 1문서.
// 이 기능을 배포하기 전 firebase.rules 의 quizScores 규칙을 먼저 Firebase에 적용해야 합니다.
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebaseClient";

export type QuizMode = "easy" | "hard";
export type QuizPool = "all" | "filtered";

export interface QuizCompletion {
  attemptId: string; // 게임 시작 시 생성한 무작위 12자 ID (재시도 시에도 동일)
  mode: QuizMode;
  questionCount: number;
  pool: QuizPool;
  score: number;
  perfect: number;
  otherCorrect: number;
  giveup: number;
}

export const QUIZ_SCORE_COLLECTION_ENABLED = process.env.REACT_APP_QUIZ_SCORE_COLLECTION === "true";

export async function saveQuizCompletion(item: QuizCompletion): Promise<void> {
  if (!QUIZ_SCORE_COLLECTION_ENABLED || process.env.NODE_ENV !== "production") return;
  // 초기 익명 인증이 아직 끝나지 않은 경우를 대비합니다.
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    console.warn("퀴즈 점수 저장 건너뜀: 익명 로그인 상태가 아닙니다.");
    return; // 인증이 안 되어도 퀴즈 결과는 보여줍니다.
  }
  // Firestore 규칙: create만 허용, update/read/delete 금지.
  // 동일 attemptId 재전송으로 기록을 바꾸지 못합니다.
  await setDoc(doc(db, "quizScores", item.attemptId), {
    uid: user.uid,
    mode: item.mode,
    questionCount: item.questionCount,
    pool: item.pool,
    score: item.score,
    perfect: item.perfect,
    otherCorrect: item.otherCorrect,
    giveup: item.giveup,
    completedAt: serverTimestamp(),
    v: 1
  });
}
