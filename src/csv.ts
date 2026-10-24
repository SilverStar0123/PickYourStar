// CSV 읽기, ES_list.csv/units.csv → 소속사·유닛·멤버 목록 만들기
import type { Agency, Group, NameMap, Member } from "./types";
import { PICK_SHEETS, SPECIAL_UNITS, type PickSheetId } from "./pickSheets";
import { LOGO_IMG_DIR, MEMBER_IMG_DIR, agencyConfig } from "./config";
import Papa from "papaparse";
import { avatarUri, badgeUri, resolveAsset, resolveImg } from "./assets";

// CSV 행의 키(BOM/공백/대소문자)와 값(따옴표)을 정리
function cleanRow(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    out[key.replace(/^\uFEFF/, "").trim().toLowerCase()] = String(row[key] ?? "");
  }
  return out;
}

export const stripQuotes = (v: unknown) => String(v ?? "").replace(/['"]/g, "").trim();

// public 폴더의 CSV 파일을 읽어 (키가 정리된) 행 배열로 반환
export function loadCsv(file: string): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    // 동일 배포에서는 같은 URL을 사용해 브라우저 캐시를 활용하고,
    // 새 GitHub 배포에서만 커밋 해시가 달라져 CSV를 새로 내려받음.
    const version = process.env.REACT_APP_CSV_VERSION || "local";
    const baseUrl = (process.env.PUBLIC_URL || ".").replace(/\/$/, "");
    Papa.parse<Record<string, string>>(`${baseUrl}/${file}?v=${encodeURIComponent(version)}`, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data.map(cleanRow)),
      error: (err) => reject(err)
    });
  });
}

// ES_list.csv(멤버)와 units.csv(유닛 로고·언어별 이름)를 읽어 소속사 → 유닛 → 멤버 목록을 만듦.
// 멤버 id는 "유닛이름::한국어이름" (서버에 저장되는 값이므로 함부로 바꾸지 마세요)
// CSV 경로가 틀려 HTML이 읽히면 code가 "csv-path"인 에러를 던집니다.
export async function loadAgencies(): Promise<Agency[]> {
  const rows = await loadCsv("ES_list.csv");
  if (rows.length > 0 && Object.keys(rows[0]).join("").includes("html")) {
    throw Object.assign(new Error("csv-path"), { code: "csv-path" }); // 경로가 틀려 HTML(404 페이지)이 읽힘
  }

  // units.csv: unit,logo  → 유닛·소속사 이름(대소문자 무시)으로 로고 연결. 파일이 없어도 정상 동작
  const logoMap: Record<string, string> = {};
  const nameMap: Record<string, NameMap> = {}; // units.csv의 name_en / name_ja
  try {
    const unitRows = await loadCsv("units.csv");
    unitRows.forEach((r) => {
      if (!("unit" in r)) return; // 파일이 없어 404 HTML이 읽힌 경우 무시
      const key = stripQuotes(r.unit).toLowerCase();
      const logo = resolveImg(stripQuotes(r.logo), LOGO_IMG_DIR);
      if (key && logo) logoMap[key] = logo;
      const en = stripQuotes(r.name_en);
      const ja = stripQuotes(r.name_ja);
      if (key && (en || ja)) nameMap[key] = { en, ja };
    });
  } catch (err) {
    console.warn("units.csv를 읽지 못해 글자 로고를 사용합니다.", err);
  }
  const usedIds = new Set<string>();
  const parsed: Agency[] = agencyConfig.map((cfg, aIdx) => {
    const groups: Group[] = [];
    cfg.units.forEach((unit) => {
      const unitRows = rows.filter(
        (r) => stripQuotes(r.unit).toLowerCase() === unit.name.toLowerCase()
      );
      if (unitRows.length === 0) return;

      groups.push({
        id: unit.name,
        name: unit.name,
        names: nameMap[unit.name.toLowerCase()],
        logo:
          logoMap[unit.name.toLowerCase()] ||
          resolveAsset(unit.logo) ||
          badgeUri(unit.name, 120, 120, true),
        members: unitRows.map((r) => {
          const mName = stripQuotes(r.name) || "알수없음";
          let id = `${unit.name}::${mName}`;
          for (let n = 2; usedIds.has(id); n++) id = `${unit.name}::${mName}#${n}`; // 동명이인 대비
          usedIds.add(id);
          const fallback = avatarUri(mName);
          return {
            id,
            groupId: unit.name,
            name: mName,
            names: { en: stripQuotes(r.name_en ?? ""), ja: stripQuotes(r.name_ja ?? "") },
            img: resolveImg(stripQuotes(r.img), MEMBER_IMG_DIR) || fallback,
            fallback
          };
        })
      });
    });
    return {
      id: `agency-${aIdx}`,
      name: cfg.name,
      names: nameMap[cfg.name.toLowerCase()],
      logo:
        logoMap[cfg.name.toLowerCase()] ||
        resolveAsset(cfg.logo) ||
        badgeUri(cfg.name, 240, 48, false),
      groups
    };
  });
  return parsed;
}


// ex_unit / shuffle1 / shuffle2를 새 취향표에 표시합니다.
// 한 사람이 여러 유닛에 속하면 '유닛A|유닛B'로 입력합니다.
export function splitSheetUnits(value: string): string[] {
  return Array.from(new Set(stripQuotes(value).split("|").map((x) => x.trim()).filter(Boolean)));
}

export async function loadSheetAgencies(sheet: PickSheetId): Promise<Agency[]> {
  if (sheet === "current") return loadAgencies();
  const source = PICK_SHEETS[sheet].source;
  const [rows, unitRows, imageRows] = await Promise.all([
    loadCsv("ES_list.csv"),
    loadCsv("units.csv").catch(() => []),
    sheet === "special" ? loadCsv("ex_unit_images.csv").catch(() => []) : Promise.resolve([])
  ]);
  if (rows.length && !rows[0].name && !rows[0].unit) {
    throw Object.assign(new Error("csv-path"), { code: "csv-path" });
  }
  const logoMap: Record<string, string> = {};
  const namesMap: Record<string, NameMap> = {};
  unitRows.forEach((r) => {
    if (!("unit" in r)) return;
    const id = stripQuotes(r.unit).toLowerCase();
    if (!id) return;
    const logo = resolveImg(stripQuotes(r.logo), LOGO_IMG_DIR);
    if (logo) logoMap[id] = logo;
    namesMap[id] = { en: stripQuotes(r.name_en), ja: stripQuotes(r.name_ja) };
  });
  const overrides = new Map<string, string>();
  imageRows.forEach((r) => {
    if (!("name" in r) || !("ex_unit" in r)) return;
    const name = stripQuotes(r.name), unit = stripQuotes(r.ex_unit), img = stripQuotes(r.img);
    if (name && unit && img) overrides.set(`${unit}::${name}`, img);
  });
  // 스페셜 유닛의 표시는 CSV를 기준으로 하되, 사용자가 지정한 유닛 순서를 우선합니다.
  // 새 이름(Double Face 등)이 추가되어도 pickSheets.ts 수정을 기다리지 않고 표시합니다.
  // 그룹 ID는 CSV에 적힌 원래 이름을 사용하므로 저장된 선택과 호환됩니다.
  const csvUnitNames = Array.from(new Set(rows.flatMap((r) => splitSheetUnits(r[source] || ""))));
  const names = sheet === "special"
    ? [...SPECIAL_UNITS.filter((unit) => csvUnitNames.includes(unit)),
       ...csvUnitNames.filter((unit) => !(SPECIAL_UNITS as readonly string[]).includes(unit))]
    : csvUnitNames;
  const groups: Group[] = names.flatMap((unit) => {
    const roster = rows.filter((r) => splitSheetUnits(r[source] || "").includes(unit));
    if (!roster.length) return []; // CSV가 준비되지 않은 팀은 빈 선택지로 표시하지 않음
    const unique = new Set<string>();
    const members: Member[] = roster.map((r) => {
      const name = stripQuotes(r.name) || "알수없음";
      let id = `${unit}::${name}`;
      for (let n = 2; unique.has(id); n++) id = `${unit}::${name}#${n}`;
      unique.add(id);
      const fallback = avatarUri(name);
      const chosenImg = overrides.get(`${unit}::${name}`) || stripQuotes(r.img);
      return {
        id, groupId: unit, name,
        names: { en: stripQuotes(r.name_en), ja: stripQuotes(r.name_ja) },
        img: resolveImg(chosenImg, MEMBER_IMG_DIR) || fallback, fallback
      };
    });
    return [{ id: unit, name: unit, names: namesMap[unit.toLowerCase()],
      logo: logoMap[unit.toLowerCase()] || badgeUri(unit, 120, 120, true), members }];
  });
  if (!groups.length) return [];
  const name = PICK_SHEETS[sheet].labels.ko;
  return [{ id: `sheet-${sheet}`, name,
    logo: badgeUri(name, 240, 48, false), groups }];
}
