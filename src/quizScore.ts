// 노래 맞추기 점수 계산. 숫자를 바꾸고 싶으면 SCORE_RULES만 고치면 됩니다.
// (결과 화면의 "점수 기준" 안내 문구도 이 값으로 자동 만들어집니다.)

export const SCORE_RULES = {
  base: 100, // 정답일 때 시작 점수
  perExtraSecond: 15, // 1초를 넘겨 들은 시간 1초당 감점
  perWrong: 10, // 오답 1회당 감점
  wrongCap: 30, // 오답 감점의 최대치
  minCorrect: 10, // 정답이면 최소 이 점수는 보장 (포기는 0점)
  freeListens: 3, // 이 횟수까지는 몇 번 들어도 감점 없음 (같은 구간을 다시 듣는 건 정상 플레이)
  perExtraListen: 2, // 무료 횟수를 넘긴 뒤 1회당 감점 (0으로 하면 들은 횟수는 기록만 하고 점수에는 반영하지 않음)
  listenCap: 10 // 들은 횟수 감점의 최대치
} as const;

export interface ScoreInput {
  correct: boolean;
  wrongCount: number; // 틀린 횟수 (정답 제출은 제외)
  clipSec: number; // 정답/포기 시점에 설정돼 있던 듣기 길이(초)
  listens: number; // 이 문제에서 1초(또는 늘린 길이) 구간을 재생한 총 횟수
}

// 문제 하나의 점수 (0~100)
export function calcQuestionScore(i: ScoreInput): number {
  if (!i.correct) return 0;
  const R = SCORE_RULES;
  const raw =
    R.base -
    R.perExtraSecond * Math.max(0, Math.round(i.clipSec) - 1) -
    Math.min(R.wrongCap, R.perWrong * Math.max(0, i.wrongCount)) -
    Math.min(R.listenCap, R.perExtraListen * Math.max(0, i.listens - R.freeListens));
  return Math.max(R.minCorrect, Math.min(R.base, raw));
}

export interface ScoredItem {
  correct: boolean;
  tries: number; // 정답 제출까지의 총 시도 횟수 (정답 포함)
  clipSec: number;
  score: number;
}

export interface ScoreSummary {
  score: number; // 최종 점수 (문제별 점수의 평균, 0~100)
  perfect: number; // 1초만 듣고 한 번에 맞힌 문제 수
  otherCorrect: number; // 그 외 정답 (더 듣거나, 틀렸다가 맞힘)
  giveup: number; // 포기
}

// total = 전체 문제 수 (아직 풀지 않은 문제는 0점으로 계산)
export function summarizeHistory(items: ScoredItem[], total: number): ScoreSummary {
  let sum = 0;
  let perfect = 0;
  let otherCorrect = 0;
  let giveup = 0;
  items.forEach((h) => {
    sum += h.score;
    if (!h.correct) giveup += 1;
    else if (h.tries === 1 && Math.round(h.clipSec) <= 1) perfect += 1;
    else otherCorrect += 1;
  });
  return { score: total > 0 ? Math.round(sum / total) : 0, perfect, otherCorrect, giveup };
}
