// 음악 퀴즈의 출제 유닛 분류.
// 정규 유닛: 취향표에 표시되는 기존 유닛(id 및 한국어/영어/일본어 표기)
// 퓨전곡: 정규 유닛 둘 이상을 &, ×, VS 등으로 연결한 이름 또는 명시적 퓨전곡 분류
// 콜라보곡: 아래 지정된 곡 제목은 유닛 구성에 관계없이 콜라보곡으로 우선 분류
// 솔로곡: songs.csv의 unit이 ES_list.csv의 캐릭터 이름(한국어/영어/일본어)과 일치하는 곡
// J&A: 셔플곡과 구분해 기타 곡의 독립 태그로 표시
// 셔플곡: 앞선 분류 어디에도 속하지 않는 나머지 모든 유닛명
// songs.csv의 원래 unit 값은 SongItem.rawUnit에 그대로 보관한다.

export const SHUFFLE_UNIT_ID = "__shuffle__";
export const FUSION_UNIT_ID = "__fusion__";
export const COLLAB_UNIT_ID = "__collab__";
export const SOLO_UNIT_ID = "__solo__";
export const JA_UNIT_ID = "__ja__";

interface OfficialUnitName {
  id: string;
  name?: string;
  names?: { ko?: string; en?: string; ja?: string };
}

const EXPLICIT_FUSION_LABELS = new Set(["퓨전곡", "퓨전 유닛", "fusion", "fusion song", "fusion songs", "fusion unit"]);
const EXPLICIT_COLLAB_LABELS = new Set(["콜라보곡", "콜라보", "collaboration", "collab", "collaboration songs", "コラボ曲"]);
const EXPLICIT_SHUFFLE_LABELS = new Set(["셔플곡", "셔플 유닛", "shuffle", "shuffle song", "shuffle songs", "shuffle unit", "shuffle units"]);

function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

// 앱에서 이미 읽은 취향표 정규 유닛을 진실의 원천으로 사용.
// 번역된 표기(예: '紅月', 'Akatsuki')도 기존 유닛으로 인식한다.
export function makeOfficialUnitAliases(units: ReadonlyArray<OfficialUnitName>): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const unit of units) {
    for (const label of [unit.id, unit.name, unit.names?.ko, unit.names?.en, unit.names?.ja]) {
      if (label && nameKey(label)) aliases.set(nameKey(label), unit.id);
    }
  }
  return aliases;
}

// ES_list.csv에 등록된 캐릭터 이름을 정규화하여 모은다.
// 현재 유닛이 없는 캐릭터(J&A/프로듀서 등)도 솔로곡으로 인식할 수 있도록
// 정규 유닛의 멤버 목록이 아닌 CSV 전체의 name/name_en/name_ja 열을 사용한다.
export function makeSoloArtistAliases(rows: ReadonlyArray<Readonly<Record<string, string>>>): Set<string> {
  const aliases = new Set<string>();
  for (const row of rows) {
    // CSV의 인용부호를 정리하고, 실제 인물 이름이 없는 행은 무시한다.
    const name = (row.name || "").replace(/^['"]+|['"]+$/g, "").trim();
    if (!name) continue;
    for (const label of [row.name, row.name_en, row.name_ja]) {
      const cleaned = (label || "").replace(/^['"]+|['"]+$/g, "");
      if (nameKey(cleaned)) aliases.add(nameKey(cleaned));
    }
  }
  return aliases;
}

// 결합 기호만으로 퓨전곡이라고 판단하지 않는다.
// 양쪽 모두 알려진 정규 유닛이어야 한다. (기호를 쓴 셔플 그룹명 오분류 방지)
const FUSION_SEPARATOR = /\s+(?:vs\.?|x)\s+|[&＆×✕✖]/i;

export function classifyQuizUnit(rawName: string, officialAliases: ReadonlyMap<string, string>): string {
  const name = rawName.trim();
  const key = nameKey(name);

  // 취향표에 있는 정규 유닛은 항상 정규 유닛으로 취급한다.
  const canonicalUnit = officialAliases.get(key);
  if (canonicalUnit) return canonicalUnit;

  // J&A는 기타 곡의 독립 카테고리. 전각 ＆ 및 공백 표기도 허용합니다.
  if (/^j\s*&\s*a$/.test(key)) return JA_UNIT_ID;

  if (EXPLICIT_COLLAB_LABELS.has(key)) return COLLAB_UNIT_ID;
  if (EXPLICIT_FUSION_LABELS.has(key)) return FUSION_UNIT_ID;
  if (EXPLICIT_SHUFFLE_LABELS.has(key)) return SHUFFLE_UNIT_ID;

  const parts = name.split(FUSION_SEPARATOR).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((part) => officialAliases.has(nameKey(part)))) {
    return FUSION_UNIT_ID;
  }

  // ES_list.csv의 shuffle1 등에 없더라도, 새로운 이름은 자동으로 셔플곡에 포함한다.
  return SHUFFLE_UNIT_ID;
}

// 콜라보곡은 반드시 곡 제목을 먼저 확인한다.
// 새 콜라보곡 추가 시 songs.csv의 title_ko 값을 아래 목록에 추가하면 된다.
// (현재 정규 유닛이나 두 유닛의 합동곡이라도 여기에 있으면 콜라보곡으로 분류)
export const COLLAB_SONG_TITLES: readonly string[] = [
  "퓨전",
  "용협청춘구",
  "U.S.A.",
  "스타라이트 퍼레이드",
  "방가방가 햄토리",
  "Tell Your World"
];

const collabTitleKeys = new Set(COLLAB_SONG_TITLES.map(nameKey));

/** 콜라보곡 제목 → 캐릭터 개인 솔로곡 → 정규 유닛/J&A/퓨전/셔플 순서로 판별. */
export function classifyQuizSongUnit(
  rawUnit: string,
  titleKo: string,
  officialAliases: ReadonlyMap<string, string>,
  soloArtistAliases?: ReadonlySet<string>
): string {
  if (collabTitleKeys.has(nameKey(titleKo))) return COLLAB_UNIT_ID;
  if (soloArtistAliases?.has(nameKey(rawUnit))) return SOLO_UNIT_ID;
  return classifyQuizUnit(rawUnit, officialAliases);
}
