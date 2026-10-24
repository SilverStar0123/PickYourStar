// 언어별 이름 표시 (id는 건드리지 않고 화면에 보이는 이름만 바꿈)
import type { Agency, NameMap } from "./types";
import type { Lang } from "./i18n";

// 선택한 언어에 맞게 소속사·유닛·멤버의 표시 이름만 바꾼 목록을 만듦 (id·그룹 키는 그대로)
export function localizeAgencies(list: Agency[], lang: Lang): Agency[] {
  if (lang === "ko") return list;
  const pick = (base: string, names?: NameMap) =>
    (lang === "ja" ? names?.ja || names?.en : names?.[lang]) || base;
  return list.map((a) => ({
    ...a,
    name: pick(a.name, a.names),
    groups: a.groups.map((g) => ({
      ...g,
      name: pick(g.name, g.names),
      members: g.members.map((m) => ({ ...m, name: pick(m.name, m.names) }))
    }))
  }));
}
