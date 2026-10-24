// 한 판이 끝났을 때만 Firestore에 최종 점수 1문서 저장. 기본값은 OFF:
// Firebase 콘솔에 퀴즈 규칙을 먼저 추가한 다음 GitHub Actions의 플래그를 true로 바꾸세요.
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
  const user = auth.currentUser;
  if (!user) return; // 인증 실패 시 게임을 막지 않음
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
