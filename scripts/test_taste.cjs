const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test/PickYourStar/#/taste'});
Object.assign(global,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,f);
require.extensions['.css']=()=>{};
const original=Module._load;Module._load=function(id,parent,main){if(id==='./csv'&&parent.filename.endsWith('TasteAnalysis.tsx'))return {loadAgencies:async()=>[]};return original.call(this,id,parent,main)};
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/similar-taste.json'),'utf8'));
let requests=0,fail=false;
global.fetch=async(url)=>{assert.ok(url.endsWith('/similar-taste.json'));requests++;return {ok:!fail,json:async()=>data}};
const React=require('react'),{createRoot}=require('react-dom/client'),{act,Simulate}=require('react-dom/test-utils');
const Page=require('../src/TasteAnalysis.tsx').default;
const {validateSimilarData}=require('../src/similarTaste.ts');
validateSimilarData(data);
const bad=JSON.parse(JSON.stringify(data));bad.groups.all.characters[0].recommendations[0].lift=999;assert.throws(()=>validateSimilarData(bad));
const root=createRoot(document.getElementById('root'));
const flush=async fn=>act(async()=>{fn?.();await Promise.resolve()});
const change=async(index,value)=>flush(()=>Simulate.change(document.querySelectorAll('select')[index],{target:{value}}));
(async()=>{
 await flush(()=>root.render(React.createElement(Page,{lang:'ko'})));
 assert.equal(document.querySelectorAll('.taste-card').length,0);
 assert.ok(!document.body.textContent.includes('%'));
 for(const [i,key]of ['all','ko','ja','en'].entries()){
  await flush(()=>document.querySelectorAll('.taste-segments button')[i].click());
  for(const c of data.groups[key].characters){
   await change(0,c.unit);await change(1,c.id);
   const names=[...document.querySelectorAll('.taste-card h3')].map(e=>e.textContent);
   assert.deepEqual(names,[...c.recommendations].sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id)).map(r=>r.name));
   assert.ok(!document.body.textContent.includes('%'));
   if(!names.length)assert.ok(document.body.textContent.includes('조건을 충족하는 조합이 부족'));
  }
 }
 assert.equal(requests,1,'switches use downloaded JSON');
 await flush(()=>root.render(React.createElement(Page,{lang:'en'})));
 assert.ok(document.body.textContent.includes('Not enough qualifying'));
 await change(0,'Knights');assert.equal(document.querySelectorAll('.taste-card').length,0,'unit change clears selection');
 await flush(()=>root.unmount());
 fail=true;const second=createRoot(document.getElementById('root'));
 await flush(()=>second.render(React.createElement(Page,{lang:'ko'})));
 assert.ok(document.querySelector('[role=alert]'));
 fail=false;await flush(()=>document.querySelector('[role=alert] button').click());
 assert.ok(document.querySelector('select'));
 await flush(()=>second.unmount());dom.window.close();
 console.log('PASS: 232 character/language combinations, numeric validation, no percentages, preserved selection rules, empty groups, error/retry, single fetch');
})().catch(e=>{console.error(e);process.exitCode=1});
