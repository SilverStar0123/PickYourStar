const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,f);
let writes=[];const original=Module._load;
Module._load=function(id,parent,main){if(parent?.filename.endsWith('/quizResults.ts')){
 if(id==='./firebaseClient')return {auth:{authStateReady:async()=>{},currentUser:{uid:'tester'}},db:{}};
 if(id==='firebase/firestore')return {doc:(_,collection,id)=>({collection,id}),serverTimestamp:()=> 'SERVER_TIME',setDoc:async(ref,data)=>writes.push({ref,data})};
}return original.call(this,id,parent,main)};
process.env.REACT_APP_QUIZ_SCORE_COLLECTION='true';process.env.NODE_ENV='production';
const {saveQuizCompletion}=require('../src/quizResults.ts');
const {calculateQuizPercentile:calc}=require('../src/quizPercentiles.ts');
const bucket=score=>{const counts=Array(101).fill(0);counts[score]=40;return {total:40,counts}};
(async()=>{
 for(const clipMode of ['random','start'])await saveQuizCompletion({attemptId:clipMode,clipMode,mode:'easy',questionCount:10,pool:'all',score:80,perfect:8,otherCorrect:0,giveup:2});
 assert.deepEqual(writes.map(w=>[w.data.clipMode,w.data.v]),[['random',2],['start',2]]);
 const data={enabled:true,groups:{'random:easy:10:all':bucket(80),'start:easy:10:all':bucket(95)}};
 assert.equal(calc(data,'easy',10,'all',80,'random').topPercent,50);
 assert.equal(calc(data,'easy',10,'all',80,'start').topPercent,100);
 const legacy={enabled:true,groups:{'easy:10:all':bucket(80)}};
 assert.equal(calc(legacy,'easy',10,'all',80,'random').topPercent,50);
 assert.equal(calc(legacy,'easy',10,'all',80,'start'),null);
 assert.equal(calc(data,'easy',10,'filtered',80,'start'),null);
 assert.equal(calc(data,'hard',10,'all',80,'start'),null);
 assert.equal(calc({enabled:false,groups:data.groups},'easy',10,'all',80,'random'),null);
 const small={enabled:true,groups:{'start:easy:10:all':{total:29,counts:Array.from({length:101},(_,i)=>i===80?29:0)}}};
 assert.equal(calc(small,'easy',10,'all',80,'start'),null);
 console.log('PASS: random/start v2 payloads, isolated percentiles, random-only legacy compatibility, sample minimum');
})().catch(e=>{console.error(e);process.exitCode=1});
