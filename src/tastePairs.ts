import type { Character } from './similarTaste';
export type TasteResult = { recommendations: Character[] };
export type TastePair = TasteResult & { characterIds: [string, string]; type: 'joint' | 'overlap' };
export type TastePairs = { schemaVersion: number; characters: Character[]; singleResults: Record<string, TasteResult>; pairResults: TastePair[] };
export function pairKey(ids: readonly string[]): string { return JSON.stringify([...ids].sort()); }
export function validateTastePairs(value: any): TastePairs {
 const fail = (): never => { throw new Error('Invalid taste pair data'); };
 if (value?.schemaVersion !== 1 || !Array.isArray(value.characters) || !value.singleResults || !Array.isArray(value.pairResults)) return fail();
 const catalog = new Map<string, Character>();
 for (const c of value.characters) {
  if (!c || typeof c.unit !== 'string' || typeof c.name !== 'string' || c.id !== `${c.unit}::${c.name}` || catalog.has(c.id)) return fail();
  catalog.set(c.id, c);
 }
 const check = (result: any, anchors: string[]) => {
  if (!result || !Array.isArray(result.recommendations) || result.recommendations.length > 3) return fail();
  const seen = new Set<string>();
  for (const r of result.recommendations) {
   const c = catalog.get(r?.id);
   if (!c || c.unit !== r.unit || c.name !== r.name || seen.has(r.id) || anchors.some(id => catalog.get(id)?.unit === r.unit)) return fail();
   seen.add(r.id);
  }
 };
 for (const id of Array.from(catalog.keys())) check(value.singleResults[id], [id]);
 const seenPairs = new Set<string>();
 for (const p of value.pairResults) {
  if (!Array.isArray(p.characterIds) || p.characterIds.length !== 2) return fail();
  const [a,b] = p.characterIds.map((id: string) => catalog.get(id));
  if (!a || !b || a.id === b.id || p.type !== (a.unit === b.unit ? 'overlap' : 'joint')) return fail();
  const key = pairKey(p.characterIds);
  if (seenPairs.has(key)) return fail();
  seenPairs.add(key); check(p, p.characterIds);
 }
 return value as TastePairs;
}
