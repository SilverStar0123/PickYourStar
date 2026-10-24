/**
 * 음악 퀴즈 정답 보정 규칙. 초보자 자동완성과 하드 모드 판정에서 공유한다.
 * 정답은 `titleKo/titleEn/titleJa/aliases` 중 하나와 비교한다.
 *
 * 기호 범례에 항목을 더할 때는 아래 SYMBOL_RULES에 추가한다.
 * - symbols: 원본 제목에 실제로 쓰인 기호
 * - typedAlternatives: 사용자가 대신 입력할 수 있는 문자 표기
 * 원래 기호를 빼고 입력해도 허용한다. 영어 철자 자체를 생략하는 것은 허용하지 않는다.
 */

export interface QuizAnswerSong {
  titleKo: string;
  titleEn: string;
  titleJa: string;
  aliases: string[];
}

interface SymbolRule {
  label: string;
  symbols: readonly string[];
  typedAlternatives: readonly string[];
}

export const SYMBOL_RULES: readonly SymbolRule[] = [
  { label: "별", symbols: ["☆", "★", "✩", "✪", "⭐", "🌟"], typedAlternatives: ["*"] },
  { label: "하트", symbols: ["♡", "♥", "❤", "❤️", "💕", "💗", "💖", "🩷"], typedAlternatives: ["<3"] },
  { label: "오른쪽 화살표", symbols: ["→", "⇒", "➡", "➜", "➝", "⟶", "⇢"], typedAlternatives: ["->", "=>"] },
  { label: "왼쪽 화살표", symbols: ["←", "⇐", "⬅", "⟵"], typedAlternatives: ["<-", "<="] },
  { label: "양방향 화살표", symbols: ["↔", "⇔", "↔️"], typedAlternatives: ["<->", "<=>"] },
  // ×는 보통 생략할 수 있지만, 곡 제목의 ×를 영문 x로 쓰는 것도 허용.
  // 일반 제목에 원래 들어 있던 x는 제거하지 않으므로 철자 판정이 느슨해지지 않는다.
  { label: "곱하기", symbols: ["×", "✕", "✖"], typedAlternatives: ["x"] }
];

/**
 * 대소문자와 모든 종류의 공백 및 특수기호를 무시한다.
 * `<3`은 하트 입력으로 취급하므로 남는 숫자 3이 정답에 영향을 주지 않는다.
 * 한글/영어/숫자/일본어는 실제 순서와 철자가 일치해야 한다.
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/<\s*3/g, "♥")
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, "");
}

/** 원래 한 곡에서 인정하던 3개 언어 제목·별칭·괄호 부제 제거본을 유지한다. */
export function getAcceptedAnswers(song: QuizAnswerSong): string[] {
  const base = [song.titleKo, song.titleEn, song.titleJa, ...song.aliases]
    .map((s) => s.trim()).filter(Boolean);
  const extra: string[] = [];
  base.forEach((title) => {
    const stripped = title.replace(/\s*[\(（\[【].*?[\)）\]】]\s*/g, "").trim();
    if (stripped && stripped.length >= 2 && stripped !== title) extra.push(stripped);
  });
  return Array.from(new Set([...base, ...extra]));
}

function normalizedTitleVariants(title: string): Set<string> {
  // 필요할 때만 대체 표기 후보를 추가한다. 예: Daydream×Reality → DaydreamxReality
  // 대부분의 별·하트·화살표 표기는 normalizeAnswer()에서 제거되므로 중복 후보가 생기지 않는다.
  let variants = new Set<string>([title.normalize("NFKC")]);
  SYMBOL_RULES.forEach((rule) => {
    const next = new Set<string>(variants);
    variants.forEach((variant) => {
      rule.symbols.forEach((symbol) => {
        if (!variant.includes(symbol)) return;
        rule.typedAlternatives.forEach((replacement) => {
          next.add(variant.split(symbol).join(replacement));
        });
      });
    });
    variants = next;
  });
  return new Set(Array.from(variants).map(normalizeAnswer).filter(Boolean));
}

/** 정확한 글자 순서를 유지하면서, 제목에 실제로 존재하는 장식 기호만 대체 허용. */
export function isCorrectGuess(guess: string, song: QuizAnswerSong): boolean {
  const normalizedGuess = normalizeAnswer(guess);
  if (!normalizedGuess) return false;
  return getAcceptedAnswers(song).some((title) => normalizedTitleVariants(title).has(normalizedGuess));
}
