const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,f);
global.window = {location:{href:'https://quiz.test/'}};
const disk = new Map();
let blocked = false, calls = 0;
global.caches = {open:async () => {
  if (blocked) throw new Error('Storage blocked');
  return {
    match:async k => disk.get(typeof k==='string'?k:k.url)?.clone(),
    delete:async k => disk.delete(typeof k==='string'?k:k.url),
    keys:async () => [...disk.keys()].map(k=>new Request(k)),
    put:async(k,v) => {disk.set(k,v.clone());},
  };
}};
global.fetch = async () => { calls++; return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}}); };
const fresh = () => {delete require.cache[require.resolve('../src/quizAudioCache.ts')];return require('../src/quizAudioCache.ts');};
const signal = () => new AbortController().signal;
const drain = () => new Promise(r=>setTimeout(r,30));
(async()=>{
 let api=fresh();
 await api.loadQuizAudio('/one.mp3',signal());
 await api.loadQuizAudio('/one.mp3',signal());
 assert.equal(calls,1,'memory reuse avoids network');
 await drain(); api=fresh();
 await api.loadQuizAudio('/one.mp3',signal());
 assert.equal(calls,1,'new page uses persistent cache');
 const now=Date.now; Date.now=()=>now()+3600001;
 await api.loadQuizAudio('/one.mp3',signal());
 assert.equal(calls,2,'expired entry refreshes');
 Date.now=now; await drain();
 api.forgetQuizAudio('/one.mp3'); await drain();
 await api.loadQuizAudio('/one.mp3',signal());
 assert.equal(calls,3,'corrupt file invalidation');
 await drain(); blocked=true; api=fresh();
 await api.loadQuizAudio('/blocked.mp3',signal());
 await api.loadQuizAudio('/blocked.mp3',signal());
 assert.equal(calls,4,'storage denied still uses memory');
 const controller=new AbortController();controller.abort();
 await assert.rejects(api.loadQuizAudio('/cancel.mp3',controller.signal),{name:'AbortError'});
 assert.equal(calls,4,'cancelled request never starts');
 global.fetch=async()=>new Response('bad',{headers:{'Content-Type':'text/html'}});
 await assert.rejects(api.loadQuizAudio('/html.mp3',signal()),/Invalid audio/);
 global.fetch=async()=>new Response('bad',{status:206});
 await assert.rejects(api.loadQuizAudio('/partial.mp3',signal()),/download failed/);
 global.fetch=async()=>new Response('bad',{headers:{'Content-Type':'audio/mpeg','Content-Length':String(25*1024*1024)}});
 await assert.rejects(api.loadQuizAudio('/large.mp3',signal()),/too large/);
 blocked=false; api=fresh();
 global.fetch=async()=>new Response(new Uint8Array([1]));
 for(let i=0;i<35;i++) await api.loadQuizAudio('/limit'+i+'.mp3',signal());
 await drain();
 assert.ok(disk.size<=30,'persistent entry count bounded');
 console.log('PASS: memory/disk request reuse, expiration, invalidation, storage denied, cancellation, bad/partial/oversize responses, eviction');
})().catch(e=>{console.error(e);process.exitCode=1});
