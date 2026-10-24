// 취향표 종류 및 인덱스/멀티방 설정.
// 각 취향표의 multiplayer / showInIndex를 true 또는 false로 바꾸면 됩니다.
// - multiplayer: 공유방 생성·참여 UI 표시 여부
// - showInIndex: 화면 위 책갈피 인덱스 표시 여부 (false여도 직접 링크는 열림)
// 주의: multiplayer를 새로 활성화하는 경우 해당 Firestore 컬렉션의 보안 규칙이 필요합니다.
export type PickSheetId = "current" | "special" | "shuffle1" | "shuffle2";

export const SPECIAL_UNITS = [
  "Eve", "Adam", "J&A", "프로듀서", "슈퍼 아이돌",
  "Double Face", "오기인", "구Valkyrie", "데드맨즈", "구fine", "Knight Killers", "team 우시와카마루", "트로이메라이",
  "Rain-bows", "Ba-barrier", "Lilith"
] as const;

// 스페셜 취향표 PNG 이미지의 섹션 구성입니다.
// 표시 순서는 아래 units 순서대로 결정됩니다. 새 유닛이 추가되어 목록에 없으면
// 이미지 맨 아래 '기타 스페셜 유닛'에 자동 배치되므로 사라지지 않습니다.
// 친숙함의 우열이 아니라 등장 맥락으로 구분하는, 화면상 정리용 섹션입니다.
export const SPECIAL_UNIT_SECTIONS = [
  {
    id: "featured",
    labels: { ko: "활동 유닛", en: "Active Units", ja: "活動ユニット" },
    units: ["Eve", "Adam", "Double Face", "프로듀서", "J&A"]
  },
  {
    id: "legacy",
    labels: { ko: "추억의 유닛", en: "Legacy Units", ja: "懐かしのユニット" },
    units: ["구fine", "오기인", "구Valkyrie", "Knight Killers", "데드맨즈"]
  },
  {
    id: "stories",
    labels: { ko: "임시 유닛", en: "Project Teams", ja: "企画チーム" },
    units: ["team 우시와카마루", "트로이메라이", "Lilith", "Rain-bows", "Ba-barrier", "슈퍼 아이돌"]
  }
] as const;

// 화면 미리보기와 PNG 저장에서 동일한 섹션 구성/순서를 사용합니다.
// 그룹의 내부 id는 CSV의 고정 유닛명, 화면에 보이는 name은 번역된 이름이어도 됩니다.
export function groupSpecialUnits<T extends { id: string }>(
  groups: T[],
  lang: "ko" | "en" | "ja"
): { id: string; title: string; groups: T[] }[] {
  const assigned = new Set<string>();
  const sections: { id: string; title: string; groups: T[] }[] = SPECIAL_UNIT_SECTIONS.map((section) => {
    const members = section.units.flatMap((unitId) =>
      groups.filter((group) => group.id === unitId)
    );
    members.forEach((group) => assigned.add(group.id));
    return { id: section.id, title: section.labels[lang], groups: members };
  }).filter((section) => section.groups.length > 0);

  const remaining = groups.filter((group) => !assigned.has(group.id));
  if (remaining.length > 0) {
    const labels = {
      ko: "그 밖의 스페셜 유닛",
      en: "More Special Units",
      ja: "その他のスペシャルユニット"
    };
    sections.push({ id: "other", title: labels[lang], groups: remaining });
  }
  return sections;
}

export type PickSheet = {
  id: PickSheetId;
  source: "unit" | "ex_unit" | "shuffle1" | "shuffle2";
  multiplayer: boolean;
  showInIndex: boolean;
  collection: string;
  route: string;
  labels: { ko: string; en: string; ja: string };
};

export const PICK_SHEETS: Record<PickSheetId, PickSheet> = {
  current: {
    id: "current",
    source: "unit",
    multiplayer: true,
    showInIndex: true,
    collection: "rooms",
    route: "#/picks",
    labels: { ko: "현재 유닛", en: "Current Units", ja: "現行ユニット" }
  },
  special: {
    id: "special",
    source: "ex_unit",
    multiplayer: false,
    showInIndex: true,
    collection: "specialRooms",
    route: "#/picks/special",
    labels: { ko: "스페셜 유닛", en: "Special Units", ja: "スペシャルユニット" }
  },
  shuffle1: {
    id: "shuffle1",
    source: "shuffle1",
    multiplayer: false,
    showInIndex: false,
    // multiplayer를 true로 바꾸기 전에 shuffle1Rooms용 Firestore 규칙을 추가하세요.
    collection: "shuffle1Rooms",
    route: "#/picks/shuffle1",
    labels: { ko: "Shuffle 1", en: "Shuffle 1", ja: "Shuffle 1" }
  },
  shuffle2: {
    id: "shuffle2",
    source: "shuffle2",
    multiplayer: false,
    showInIndex: false,
    // multiplayer를 true로 바꾸기 전에 shuffle2Rooms용 Firestore 규칙을 추가하세요.
    collection: "shuffle2Rooms",
    route: "#/picks/shuffle2",
    labels: { ko: "Shuffle 2", en: "Shuffle 2", ja: "Shuffle 2" }
  }
};

// 내부용 전체 목록: 숨긴 취향표의 주소와 저장 데이터도 그대로 유지합니다.
export const PICK_SHEET_IDS: PickSheetId[] = ["current", "special", "shuffle1", "shuffle2"];
// 인덱스에 표시할 목록: showInIndex가 true인 종류만 보여 줍니다.
export const VISIBLE_PICK_SHEET_IDS: PickSheetId[] = PICK_SHEET_IDS.filter(
  (id) => PICK_SHEETS[id].showInIndex
);

// 해시 주소가 선택지를 명시하지 않는 경우(퀴즈 화면 등) null을 반환합니다.
export function sheetFromHash(hash: string): PickSheetId | null {
  const path = hash.replace(/^#\/?/, "").split("?")[0].replace(/\/$/, "").toLowerCase();
  if (path === "picks" || path === "home") return "current";
  if (path === "picks/special") return "special";
  if (path === "picks/shuffle1") return "shuffle1";
  if (path === "picks/shuffle2") return "shuffle2";
  return null;
}

// 기존 취향표의 로컬 저장 키는 그대로 유지해 과거 데이터를 보호합니다.
export function sheetLocalKey(base: string, sheet: PickSheetId): string {
  return sheet === "current" ? base : `${base}:${sheet}`;
}
