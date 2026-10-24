// node scripts/test_quiz_solo_grouping.cjs
// 최신 ES_list.csv 이름 목록과 가상 솔로곡을 이용한 자동 분류 검사
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/quizUnits.ts'), 'utf8');
const result = ts.transpileModule(source, {
  fileName: 'quizUnits.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true
});
assert.equal(result.diagnostics.length, 0);
const local = { exports: {} };
new Function('module', 'exports', result.outputText)(local, local.exports);
const {
  makeOfficialUnitAliases, makeSoloArtistAliases, classifyQuizSongUnit,
  SOLO_UNIT_ID, COLLAB_UNIT_ID, SHUFFLE_UNIT_ID, FUSION_UNIT_ID
} = local.exports;

const official = makeOfficialUnitAliases([
  { id: 'Trickstar' }, { id: 'UNDEAD' }, { id: 'Crazy:B' },
  { id: '홍월', names: { en: 'Akatsuki', ja: '紅月' } }
]);
const solo = makeSoloArtistAliases([
  { name: '사쿠마 레이', name_en: 'Sakuma Rei', name_ja: '朔間零' },
  { name: 'HiMERU', name_en: 'HiMERU', name_ja: 'HiMERU' },
  { name: '사가미 진', name_en: 'Sagami Jin', name_ja: '佐賀美 陣' },
  { name: '안즈' },
  { name: '', name_en: 'not a person' }
]);
const cases = [
  ['사쿠마 레이', '솔로 신곡', SOLO_UNIT_ID],
  ['Sakuma Rei', 'Solo Single', SOLO_UNIT_ID],
  ['朔間零', 'ソロ', SOLO_UNIT_ID],
  ['HiMERU', '테스트 곡', SOLO_UNIT_ID],
  ['himeru', '테스트 곡', SOLO_UNIT_ID],
  ['사가미 진', '테스트 곡', SOLO_UNIT_ID],
  ['Sagami Jin', '테스트 곡', SOLO_UNIT_ID],
  ['  佐賀美  陣 ', '테스트 곡', SOLO_UNIT_ID],
  ['안즈', '테스트 곡', SOLO_UNIT_ID],
  ['Trickstar', '테스트 곡', 'Trickstar'],
  ['UNDEAD', '테스트 곡', 'UNDEAD'],
  ['UNDEAD × 홍월', '테스트 곡', FUSION_UNIT_ID],
  ['√AtoZ', '테스트 곡', SHUFFLE_UNIT_ID],
  ['not a person', '테스트 곡', SHUFFLE_UNIT_ID],
  // 예외 목록인 콜라보곡은 솔로 인명과 일치해도 콜라보 우선
  ['사쿠마 레이', 'U.S.A.', COLLAB_UNIT_ID],
  ['UNDEAD × 홍월', '용협청춘구', COLLAB_UNIT_ID],
  ['√AtoZ', '퓨전', COLLAB_UNIT_ID],
  ['Crazy:B', 'Tell Your World', COLLAB_UNIT_ID]
];
for (const [unit, song, expected] of cases) {
  assert.equal(classifyQuizSongUnit(unit, song, official, solo), expected, `${unit} / ${song}`);
}
console.log(`솔로곡/기존 분류 테스트 ${cases.length}개 통과`);
