export type Segment = 'all' | 'ko' | 'ja' | 'en';
export type Character = { id: string; unit: string; name: string };
export type Recommendation = Character & { pairCount: number; baseCount: number; populationCount: number; overallCount: number; togetherRate: number; overallRate: number; lift: number };
export type Profile = Character & { selectedCount: number; recommendations: Recommendation[] };
export type SimilarData = { schemaVersion: number; analysisType: string; dataExportedOn: string; method: { ranking: string; minimumBaseCount: number; minimumPairCount: number; minimumLiftExclusive: number; excludedUnits: string[] }; groups: Record<Segment,{ recordCount: number; characters: Profile[] }> };
export function validateSimilarData(value: any): SimilarData {
 const fail = () => { throw new Error('Invalid similar-taste data'); };
 const integer = (n: any) => Number.isInteger(n) && n >= 0;
 const character = (c: any) => c && typeof c.unit === 'string' && typeof c.name === 'string' && c.id === `${c.unit}::${c.name}`;
 if(value?.schemaVersion !== 1 || value.analysisType !== 'similar-taste' || typeof value.dataExportedOn !== 'string') fail();
 const m = value.method;
 if(!m || m.ranking !== 'lift' || !integer(m.minimumBaseCount) || !integer(m.minimumPairCount) || !Number.isFinite(m.minimumLiftExclusive) || !Array.isArray(m.excludedUnits)) fail();
 for(const key of ['all','ko','ja','en']) {
  const g=value.groups?.[key];
  if(!g || !integer(g.recordCount) || !Array.isArray(g.characters)) fail();
  const ids = new Set();
  for(const c of g.characters) {
   if(!character(c) || ids.has(c.id) || !integer(c.selectedCount) || c.selectedCount>g.recordCount || !Array.isArray(c.recommendations) || c.recommendations.length>3) fail();
   ids.add(c.id); const recIds = new Set();
   for(const r of c.recommendations) {
    if(!character(r) || r.unit===c.unit || recIds.has(r.id) || m.excludedUnits.includes(`pick_${r.unit}`)) fail();
    recIds.add(r.id);
    if(![r.pairCount,r.baseCount,r.populationCount,r.overallCount].every(integer) || r.baseCount < m.minimumBaseCount || r.pairCount < m.minimumPairCount || r.pairCount>r.baseCount || r.baseCount>c.selectedCount || r.pairCount>r.overallCount || r.overallCount>r.populationCount || r.populationCount>g.recordCount || r.baseCount>r.populationCount || r.overallCount===0 || r.baseCount===0) fail();
    const together=r.pairCount/r.baseCount, overall=r.overallCount/r.populationCount;
    if(![r.togetherRate,r.overallRate,r.lift].every(Number.isFinite) || Math.abs(r.togetherRate-together)>1e-8 || Math.abs(r.overallRate-overall)>1e-8 || Math.abs(r.lift-together/overall)>1e-8 || r.lift<=m.minimumLiftExclusive) fail();
   }
  }
 }
 return value;
}
