// Offline component regression tests: no Firebase writes or YouTube network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/#/quiz', pretendToBeVisual: true });
Object.assign(global, { window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({ matches: false });
window.HTMLElement.prototype.scrollIntoView = () => {};
const clock = FakeTimers.withGlobal(window).install({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
global.fetch = async () => ({ ok: true, json: async () => ({ videos: {} }) });
const sourceRoot = path.resolve(__dirname, '../src');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => {
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React,
    esModuleInterop: true
  } }).outputText, file);
};
require.extensions['.css'] = () => {};
let row = {};
const load = Module._load;
Module._load = function(id, parent, main) {
  if (parent?.filename.startsWith(sourceRoot)) {
    if (id === './csv') return {
      loadAgencies: async () => [{ id: 'agency', name: 'Agency', groups: [{ id: 'fine', name: 'fine', members: [] }] }],
      loadCsv: async (file) => file === 'songs.csv' ? [row] : [],
      stripQuotes: (s) => String(s ?? '').replace(/['"]/g, '').trim()
    };
    if (id === './analytics') return { trackAnalyticsEvent() {} };
    if (id === './rooms') return { generateRoomId: () => 'testrun123456' };
    if (id === './quizResults') return { saveQuizCompletion: async () => {} };
    if (id === './imageExport') return {};
    if (id === './quizShare') return { ...load.call(this, id, parent, main), renderQuizResultBlob: async () => new Blob() };
  }
  return load.call(this, id, parent, main);
};
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils');
const SongQuiz = require('../src/SongQuiz.tsx').default;
let audios = [], players = [], root;
class MockAudio extends window.EventTarget {
  constructor() { super(); this.currentTime = 0; this.duration = 150; this.ended = false; this.src = ''; this.playCalls = 0; audios.push(this); }
  load() {}
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  play() { this.playCalls++; this.paused = false; return this.rejectPlay ? Promise.reject(new Error('decode failure')) : Promise.resolve(); }
  emit(type) { this.dispatchEvent(new window.Event(type)); }
}
global.Audio = window.Audio = MockAudio;
window.YT = { Player: class {
  constructor(iframe, { events }) { this.iframe = iframe; this.events = events; this.videoId = iframe.src.split('/embed/')[1].split('?')[0]; this.plays = 0; this.state = -1; players.push(this); }
  ready() { this.events.onReady({ target: this }); }
  playVideo() { this.plays++; this.state = 1; this.events.onStateChange({ data: 1, target: this }); }
  pauseVideo() { this.state = 2; }
  cueVideoById(o) { this.videoId = o.videoId; this.start = o.startSeconds; this.state = 5; this.events.onStateChange({ data: 5, target: this }); }
  loadVideoById(o) { this.videoId = o.videoId; this.start = o.startSeconds; this.playVideo(); }
  seekTo(s) { this.start = s; }
  getPlayerState() { return this.state; }
  getVideoData() { return { video_id: this.videoId }; }
  getDuration() { return 150; }
  destroy() { this.destroyed = true; this.iframe.remove(); }
} };
const flush = async (fn = () => {}) => { await act(async () => { fn(); await Promise.resolve(); }); };
const click = async (key) => flush(() => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith(key));
  assert.ok(button, `button ${key}`); assert.equal(button.disabled, false, `${key} enabled`); button.click();
});
async function start(audio = true) {
  if (root) await flush(() => root.unmount());
  audios = []; players = []; clock.reset();
  row = { unit: 'fine', title_ko: 'Test Song', title_en: 'Test Song', youtube: 'abcdefghijk', start_min: '15', end_max: '100', audio_url: audio ? 'audio/test.mp3' : '' };
  root = createRoot(document.getElementById('root'));
  await flush(() => root.render(React.createElement(SongQuiz, { lang: 'en', t: (key, args) => key + (args ? JSON.stringify(args) : '') })));
  await click('quizStartBtn');
}
(async () => {
  // Successful files use Audio exclusively and stop at the requested position.
  await start(); assert.equal(audios.length, 1); assert.equal(players.length, 0);
  await flush(() => audios[0].emit('canplay'));
  await click('quizPlayClip'); assert.equal(audios[0].playCalls, 1);
  await flush(() => audios[0].emit('playing'));
  await flush(() => { audios[0].currentTime += 1; clock.tick(25); });
  assert.equal(audios[0].paused, true); assert.equal(players.length, 0);

  // Missing/corrupt file during preload: prepare YouTube silently, then play on click.
  await start(); const broken = audios[0]; await flush(() => broken.emit('error'));
  assert.equal(players.length, 1); assert.equal(players[0].plays, 0);
  await flush(() => players[0].ready()); await click('quizPlayClip');
  assert.equal(players[0].plays, 1); assert.equal(broken.playCalls, 0);
  await flush(() => clock.tick(1000)); await click('quizPlayClip'); assert.equal(players[0].plays, 2);

  // Promise rejection during playback automatically falls back once.
  await start(); await flush(() => audios[0].emit('canplay')); audios[0].rejectPlay = true;
  await click('quizPlayClip'); assert.equal(players.length, 1);
  await flush(() => players[0].ready()); assert.equal(players[0].plays, 1);

  // An in-flight error keeps the selected duration and start; stale errors are ignored.
  await start(); await flush(() => audios[0].emit('canplay')); await click('quizExtendSec');
  const failed = audios[0], startTime = failed.currentTime;
  await flush(() => { failed.emit('playing'); failed.emit('error'); failed.emit('error'); });
  assert.equal(players.length, 1); assert.ok(players[0].iframe.src.includes(`start=${Math.floor(startTime)}`));
  await flush(() => players[0].ready());
  await flush(() => clock.tick(1000)); assert.equal(players[0].state, 1, '2-second clip remains playing');
  await flush(() => clock.tick(1000)); assert.equal(players[0].state, 2);

  // Failed files stay on YouTube in later questions; fallback counts as one listen.
  const audioCount = audios.length;
  await flush(() => Simulate.change(document.querySelector('.sq-input'), { target: { value: 'Test Song' } }));
  await click('quizSubmitBtn');
  for (let i = 1; i < 10; i++) {
    await click('quizNextBtn');
    assert.equal(audios.length, audioCount, 'failed file is not retried');
    await click('quizGiveUpBtn');
  }
  await click('quizFinishBtn');
  assert.ok(document.body.textContent.includes('quizSongMeta{"sec":2,"listens":1,"tries":1}'), 'one listen after fallback');

  // Buffering after playback has started is bounded too.
  await start(); await flush(() => audios[0].emit('canplay')); await click('quizPlayClip');
  await flush(() => { audios[0].emit('playing'); audios[0].emit('waiting'); });
  await flush(() => clock.tick(8000)); assert.equal(players.length, 1);
  await flush(() => players[0].ready()); assert.equal(players[0].plays, 1);

  // Preparation timeout does not autoplay.
  await start(); await flush(() => clock.tick(8000));
  assert.equal(players.length, 1); assert.equal(players[0].plays, 0);

  // Playback timeout automatically continues on YouTube.
  await start(); await flush(() => audios[0].emit('canplay')); await click('quizPlayClip');
  await flush(() => clock.tick(8000)); assert.equal(players.length, 1);
  await flush(() => players[0].ready()); assert.equal(players[0].plays, 1);

  // Leaving the question cancels failure timers/listeners and pending play promises.
  await start(); const oldAudio = audios[0]; await click('quizPlayClip'); await click('quizBackToSetup');
  await flush(() => { oldAudio.emit('error'); clock.tick(16000); }); assert.equal(players.length, 0);

  // Songs without local files retain YouTube behavior.
  await start(false); assert.equal(audios.length, 0); assert.equal(players.length, 1);
  await flush(() => players[0].ready()); await click('quizPlayClip'); assert.equal(players[0].plays, 1);
  await flush(() => root.unmount()); root = null; clock.uninstall(); dom.window.close();
  console.log('PASS: audio-first, preload/playback failures, fallback retry, duration/start, timeouts, cancellation, YouTube-only');
})().catch(e => { console.error(e); clock.uninstall(); dom.window.close(); process.exit(1); });
