/** 초보자 모드 자동완성: 곡 제목과 유닛명(원본/번역/별칭)을 함께 검색한다. */
import { getAcceptedAnswers, normalizeAnswer } from "./quizAnswer";
import type { QuizAnswerSong } from "./quizAnswer";

export interface SearchableQuizSong extends QuizAnswerSong {
  id: string;
  unit: string;
  rawUnit: string;
}

// units.csv가 영문 이름만 가진 유닛에 대해서도 흔히 쓰는 한국어 이름으로 찾을 수 있게 한다.
export const QUIZ_UNIT_KO_ALIASES: Readonly<Record<string, readonly string[]>> = {
  fine: ["피네"],
  Trickstar: ["트릭스타"],
  "유성대": ["류세타이"],
  ALKALOID: ["알칼로이드"],
  Eden: ["에덴"],
  Valkyrie: ["발키리"],
  "2wink": ["투윙크"],
  "Crazy:B": ["크레이지비"],
  UNDEAD: ["언데드"],
  "Ra*bits": ["라빗츠", "라비츠"],
  "홍월": ["아카츠키"],
  Knights: ["나이츠"],
  Switch: ["스위치"],
  MaM: ["마므", "맘"],
  "MELLOW DEAR US": ["멜로우 디어 어스"],
  "Special for Princess!": ["스페셜 포 프린세스"],
};

function matchRank(haystack: readonly string[], query: string): number {
  const normalized = haystack.map(normalizeAnswer).filter(Boolean);
  if (normalized.some((n) => n === query)) return 0;
  if (normalized.some((n) => n.startsWith(query))) return 1;
  if (normalized.some((n) => n.includes(query))) return 2;
  return 99;
}

/**
 * 검색어가 없으면 이전처럼 이름순 60곡만 미리 보여 준다.
 * 유닛 이름 검색 시에는 해당 유닛의 곡이 60개 이상이어도 모두 표시한다.
 * 검색은 현재 퀴즈에서 선택된 출제곡(pool) 안에서만 수행한다.
 */
export function findQuizSongSuggestions<T extends SearchableQuizSong>(
  pool: readonly T[],
  input: string,
  lang: "ko" | "en" | "ja",
  unitLabels: Readonly<Record<string, readonly string[]>>
): T[] {
  const primaryTitle = (s: T) =>
    lang === "ja" ? s.titleJa || s.titleEn || s.titleKo
      : lang === "en" ? s.titleEn || s.titleKo || s.titleJa
      : s.titleKo || s.titleEn || s.titleJa;
  const query = normalizeAnswer(input);
  if (!query) {
    // 특수문자만 입력했을 때 전체 곡이 갑자기 펼쳐지는 것을 막는다.
    if (input.trim()) return [];
    return [...pool].sort((a, b) => primaryTitle(a).localeCompare(primaryTitle(b))).slice(0, 60);
  }

  const matched: { song: T; rank: number }[] = [];
  for (const song of pool) {
    const titleRank = matchRank(getAcceptedAnswers(song), query);
    const names = [song.unit, song.rawUnit, ...(unitLabels[song.unit] || []), ...(QUIZ_UNIT_KO_ALIASES[song.unit] || [])];
    const unitRank = matchRank(names, query);
    if (titleRank === 99 && unitRank === 99) continue;
    // 정확한 곡 제목 / 정확한 유닛명 / 곡 제목 접두 / 유닛 접두 / 제목 포함 / 유닛 포함
    const rank = Math.min(titleRank === 99 ? 99 : titleRank * 2, unitRank === 99 ? 99 : unitRank * 2 + 1);
    matched.push({ song, rank });
  }
  return matched
    .sort((a, b) => a.rank - b.rank || primaryTitle(a.song).localeCompare(primaryTitle(b.song)))
    .map((item) => item.song);
}
