// 초보자 자동완성 테스트: React/Firebase 없이 TypeScript 소스 두 개만 로드
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
let ts;
try { ts = require('typescript'); }
catch { ts = require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); }
const root = path.join(__dirname, '..');
function load(rel, deps = {}) {
  const filename = path.join(root, rel);
  const transformed = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    reportDiagnostics: true
  });
  assert.equal(transformed.diagnostics.length, 0, `${rel} syntax check`);
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', transformed.outputText)(mod, mod.exports, (dep) => {
    assert.ok(dep in deps, `unexpected import ${dep}`);
    return deps[dep];
  });
  return mod.exports;
}
const answers = load('src/quizAnswer.ts');
const { findQuizSongSuggestions } = load('src/quizSuggestions.ts', { './quizAnswer': answers });
const makeSong = (id, unit, rawUnit, titleKo, titleEn = titleKo, titleJa = titleKo, aliases = []) =>
  ({ id, unit, rawUnit, titleKo, titleEn, titleJa, aliases });
const songs = [
  makeSong('1', 'Trickstar', 'Trickstar', '리벨리온 스타', 'Rebellion Star'),
  makeSong('2', 'Trickstar', 'Trickstar', 'ONLY YOUR STARS!', 'ONLY YOUR STARS!'),
  makeSong('3', 'UNDEAD', 'UNDEAD', '멜로디', 'Melody'),
  makeSong('4', '__shuffle__', 'Eve', 'Sunlit Smile!', 'Sunlit Smile!'),
  makeSong('5', '__shuffle__', 'Adam', 'Ruler’s Truth', 'Ruler’s Truth'),
  makeSong('6', '__fusion__', 'Trickstar & UNDEAD', '퓨전 노래', 'Fusion Tune'),
  makeSong('7', '홍월', '홍월', '풍류의 노래', 'Song of Akatsuki', '紅月の曲'),
  makeSong('8', 'fine', 'fine', 'Angel', 'Angel')
];
const labels = {
  'Trickstar': ['Trickstar'],
  'UNDEAD': ['UNDEAD'],
  '홍월': ['홍월', 'Akatsuki', '紅月'],
  'fine': ['fine'],
  '__shuffle__': ['셔플곡', 'Shuffle'],
  '__fusion__': ['퓨전곡', 'Fusion']
};
const find = (query, pool = songs, lang = 'ko') => findQuizSongSuggestions(pool, query, lang, labels).map((x) => x.id);
assert.deepEqual(find('트릭스타').slice(0, 2).sort(), ['1', '2']);
assert.deepEqual(find('Trickstar').slice(0, 2).sort(), ['1', '2']);
assert.deepEqual(find('UNDEAD').slice(0, 1), ['3']);
assert.deepEqual(find('홍월').slice(0, 1), ['7']);
assert.deepEqual(find('Akatsuki'), ['7']);
assert.deepEqual(find('紅月').slice(0, 1), ['7']);
assert.deepEqual(find('이브'), []); // CSV에 없는 별도 번역을 임의로 만들지 않음
assert.deepEqual(find('Eve'), ['4']);
assert.deepEqual(find('Sunlit'), ['4']);
assert.deepEqual(find('Rebellion Star'), ['1']);
assert.deepEqual(find('리벨리온'), ['1']);
assert.deepEqual(find('나이츠'), []); // 해당 유닛의 곡이 출제 목록에 없음
assert.deepEqual(find('Trickstar', songs.filter((s) => s.unit === 'UNDEAD')), []);
assert.deepEqual(find('ㅁㄴㅇㄹ'), []);
assert.equal(find('')[0], '8'); // 가나다가 아닌 제목 정렬
assert.deepEqual(find('fine'), ['8']);
const bulk = Array.from({ length: 72 }, (_, i) => makeSong(`bulk-${i}`, 'UNDEAD', 'UNDEAD', `곡 ${i}`));
assert.equal(findQuizSongSuggestions(bulk, '언데드', 'ko', labels).length, 72, '유닛 검색은 60곡 제한 없이 전부 표시');
assert.equal(findQuizSongSuggestions(bulk, '', 'ko', labels).length, 60, '검색어 없으면 기존 60곡 제한');
const scored = load('src/quizScore.ts');
assert.equal(scored.calcQuestionScore({ correct: true, wrongCount: 0, clipSec: 1, listens: 1 }), 100);
assert.equal(scored.calcQuestionScore({ correct: true, wrongCount: 1, clipSec: 1, listens: 1 }), 90);
const quizSource = fs.readFileSync(path.join(root, 'src/SongQuiz.tsx'), 'utf8');
assert.ok(!quizSource.includes('showUnitHint'), '유닛 힌트 UI/상태 제거 확인');
console.log('✅ 초보자 유닛명 검색·정답 검색·출제범위·60곡 제한·힌트 제거 테스트 통과');
