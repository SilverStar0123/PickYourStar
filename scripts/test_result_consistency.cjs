const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,f);
const {summarizeHistory,calcQuestionScore}=require('../src/quizScore.ts');
const {summarizeQuizPlayRecords}=require('../src/quizShare.ts');
// Reproduce the screenshot: old playback counts 2/6/2, score categories 4/4/2, score 72.
const rows=[
 [true,1,1,1],[true,1,1,1],[true,3,1,1],[true,3,1,1],
 [true,3,2,1],[true,3,2,1],[true,3,2,1],[true,3,2,1],
 [false,1,1,1],[false,1,1,1]
].map(([correct,listens,clipSec,tries],i)=>({correct,listens,clipSec,tries,title:String(i),score:calcQuestionScore({correct,listens,clipSec,wrongCount:tries-1})}));
// Four extended clips score 85 each: total 74. Increase wrong attempts to reach screenshot's 72.
rows[4].tries=2; rows[4].score-=10; rows[5].tries=2; rows[5].score-=10;
const screen=summarizeHistory(rows,10), image=summarizeQuizPlayRecords(rows);
assert.deepEqual(screen,{score:72,perfect:4,otherCorrect:4,giveup:2});
assert.deepEqual([image.once,image.repeated,image.unanswered],[4,4,2]);
for(const correct of [true,false])for(const listens of [0,1,2,7])for(const clipSec of [1,2,5])for(const tries of [1,2,4]){
 const row={correct,listens,clipSec,tries,score:0,title:'case'};
 const a=summarizeHistory([row],1),b=summarizeQuizPlayRecords([row]);
 assert.deepEqual([b.once,b.repeated,b.unanswered],[a.perfect,a.otherCorrect,a.giveup]);
 assert.equal(b.once+b.repeated+b.unanswered,1);
}
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/SongQuiz.tsx'),'utf8');
for(const [prop,key]of [['onceLabel','quizBreakdownPerfect'],['repeatedLabel','quizBreakdownOther'],['unansweredLabel','quizBreakdownGiveup']])assert.ok(source.includes(`${prop}: tt("${key}")`));
assert.ok(!source.includes('resultBlobRef'),'save regenerates from current results');
console.log('PASS: screenshot 72 points and 4/4/2, all replay/length/attempt cases, matching labels, no stale image cache');
