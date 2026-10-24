// Standalone smoke test for the new pick-sheet category and CSV transformation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = (() => { try { return require('typescript'); } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); } })();
const src = path.join(__dirname,'..','src');
function compile(file, mocks={}) {
  const name=path.join(src,file);
  const js=ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
  const m = new Module(name, module);
  m.filename=name;
  m.paths=module.paths;
  m.require=(request)=> request in mocks ? mocks[request] : require(request);
  m._compile(js,name);
  return m.exports;
}
const sheets=compile('pickSheets.ts');
assert.deepEqual(sheets.PICK_SHEET_IDS,['current','special','shuffle1','shuffle2']);
assert.equal(sheets.SPECIAL_UNITS.length,13);
assert.equal(sheets.PICK_SHEETS.special.collection,'specialRooms');
assert.equal(sheets.PICK_SHEETS.shuffle1.multiplayer,false);
assert.equal(sheets.sheetFromHash('#/picks/special'),'special');
assert.equal(sheets.sheetFromHash('#/picks'),'current');
assert.equal(sheets.sheetFromHash('#/quiz'),null);
assert.equal(sheets.sheetLocalKey('es_my_picks','current'),'es_my_picks');
assert.equal(sheets.sheetLocalKey('es_my_picks','special'),'es_my_picks:special');
const mockRows={
 'ES_list.csv': [
   {name:'A',unit:'fine',ex_unit:'Eve|Adam',shuffle1:'A/B',shuffle2:'',img:'a.webp',name_en:'Alpha',name_ja:'アルファ'},
   {name:'B',unit:'Trickstar',ex_unit:'Eve',shuffle1:'A/B',shuffle2:'',img:'b.webp'},
   {name:'C',unit:'UNDEAD',ex_unit:'Rain-bows',shuffle1:'',shuffle2:'B-team',img:'c.webp'}
 ],
 'units.csv': [{unit:'Eve',logo:'eve.webp',name_en:'Eve',name_ja:'Eve'}],
 'ex_unit_images.csv': [{name:'A',ex_unit:'Adam',img:'a_old.webp'}]
};
const papa={parse:(u,opts)=>{const file=u.split('/').at(-1).split('?')[0];opts.complete({data:mockRows[file]||[]})}};
const assets={avatarUri:x=>'avatar:'+x,badgeUri:x=>'badge:'+x,resolveAsset:x=>x,resolveImg:(x,d)=>x?d+'/'+x:undefined};
const config={MEMBER_IMG_DIR:'img',LOGO_IMG_DIR:'img/logo',agencyConfig:[]};
const csv=compile('csv.ts',{'./config':config,'./pickSheets':sheets,'./assets':assets,'papaparse':papa});
assert.deepEqual(csv.splitSheetUnits('Eve| Adam |Eve|'),['Eve','Adam']);
Promise.all([csv.loadSheetAgencies('special'),csv.loadSheetAgencies('shuffle1'),csv.loadSheetAgencies('shuffle2')]).then(([special,shuffle1,shuffle2])=>{
  assert.equal(special.length,1);
  assert.deepEqual(special[0].groups.map(g=>g.id),['Rain-bows','Eve','Adam']);
  const eve=special[0].groups.find(g=>g.id==='Eve');
  const adam=special[0].groups.find(g=>g.id==='Adam');
  assert.deepEqual(eve.members.map(m=>m.name),['A','B']);
  assert.equal(adam.members[0].img,'img/a_old.webp');
  assert.equal(eve.members[0].img,'img/a.webp');
  assert.equal(adam.members[0].id,'Adam::A');
  assert.equal(shuffle1[0].groups[0].members.length,2);
  assert.equal(shuffle2[0].groups[0].members[0].name,'C');
  console.log('11 routing/config/CSV/inheritance checks passed');
}).catch(e=>{console.error(e);process.exitCode=1});
