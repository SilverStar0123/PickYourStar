import React, { useEffect, useState } from 'react';
import type { Lang } from './i18n';
import type { Character } from './similarTaste';
import { pairKey } from './tastePairs';
import { TASTE_UNIT_ORDER } from './tasteOrder';

type UnitResults = Record<string, Character | null>;
type UnitData = { schemaVersion: number; results: Record<string, UnitResults> };
export function validateUnitData(value: any, catalog: readonly Character[]): UnitData {
 if(value?.schemaVersion!==1 || !value.results || typeof value.results!=='object' || Array.isArray(value.results))throw Error('Invalid unit data');
 const known=new Map(catalog.map(c=>[c.id,c]));
 for(const [key,result] of Object.entries(value.results)){
  const ids: unknown=JSON.parse(key);
  if(!Array.isArray(ids)||ids.length<1||ids.length>2||new Set(ids).size!==ids.length||ids.some(id=>!known.has(id))||pairKey(ids)!==key)throw Error('Invalid selection');
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid results');
  for(const [unit,c] of Object.entries(result)){
   if(!TASTE_UNIT_ORDER.includes(unit)||ids.some(id=>known.get(id)?.unit===unit))throw Error('Invalid unit');
   if(c!==null){const candidate=c as Character;const original=known.get(candidate.id);
    if(!original||original.unit!==unit||candidate.unit!==unit||original.name!==candidate.name)throw Error('Invalid character');
   }
  }
 }
 return value;
}
export default function TasteUnitDetails({lang,ids,catalog,name,unitName,portrait}:{lang:Lang;ids:string[];catalog:Character[];name:(c:Character)=>string;unitName:(unit:string)=>string;portrait:(c:Character)=>React.ReactNode}){
 const [open,setOpen]=useState(false),[data,setData]=useState<UnitData|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 const key=pairKey(ids);
 const catalogKey=catalog.map(c=>c.id).join('|');
 useEffect(()=>{setOpen(false);},[key]);
 useEffect(()=>{
  if(!open||data)return;
  const controller=new AbortController();let active=true;setError(false);
  fetch(`${process.env.PUBLIC_URL||'.'}/similar-taste-units.json`,{signal:controller.signal,cache:'no-cache'})
   .then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>validateUnitData(v,catalog))
   .then(v=>{if(active)setData(v);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;controller.abort();};
  // The catalog contents, not the new array identity on each render, control reloads.
 },[open,data,retry,catalogKey]);
 const t={
  ko:{show:'다른 유닛의 취향도 보기',hide:'다른 유닛의 취향 접기',intro:'선택한 캐릭터와 연결되는 취향을 유닛별로 살펴보세요. 유닛 순서대로 표시하며 인기 순위는 아니에요.',empty:'아직 뚜렷한 연결을 찾지 못했어요.',loading:'유닛별 취향을 불러오는 중…',unavailable:'유닛별 분석 데이터를 아직 불러올 수 없어요.',retry:'다시 시도',missing:'이 조합의 유닛별 분석은 아직 준비되지 않았어요.'},
  en:{show:'Explore other units',hide:'Hide other units',intro:'Explore connections by unit, in unit order. This is not a popularity ranking.',empty:'No clear connection yet.',loading:'Loading unit connections…',unavailable:'Unit analysis data is not available yet.',retry:'Retry',missing:'Unit analysis for this selection is not ready yet.'},
  ja:{show:'ほかのユニットの好みを見る',hide:'ユニット別の好みを閉じる',intro:'選んだキャラクターとのつながりをユニット順で紹介します。人気ランキングではありません。',empty:'まだ明確なつながりは見つかっていません。',loading:'読み込み中…',unavailable:'ユニット別の分析データを読み込めません。',retry:'再試行',missing:'この組み合わせの分析はまだ準備されていません。'}
 }[lang];
 const result=data?.results[key];
 return <section className="taste-unit-details"><button className="taste-unit-toggle" type="button" aria-expanded={open} aria-controls="taste-unit-panel" onClick={()=>setOpen(!open)}>{open?t.hide:t.show}<span aria-hidden="true">{open?'−':'+'}</span></button>
 {open&&<div id="taste-unit-panel"><p className="taste-note">{t.intro}</p>
 {error?<div className="taste-state" role="alert">{t.unavailable}<p><button onClick={()=>setRetry(n=>n+1)}>{t.retry}</button></p></div>:!data?<p role="status">{t.loading}</p>:!result?<p>{t.missing}</p>:<div className="taste-unit-grid">{TASTE_UNIT_ORDER.filter(u=>Object.prototype.hasOwnProperty.call(result,u)).map(u=>{const c=result[u];return <article className="taste-unit-card" key={u}><h3>{unitName(u)}</h3>{c?<>{portrait(c)}<p>{name(c)}</p></>:<p className="taste-unit-empty">{t.empty}</p>}</article>;})}</div>}
 </div>}</section>;
}
