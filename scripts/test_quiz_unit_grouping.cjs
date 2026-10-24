// `node scripts/test_quiz_unit_grouping.cjs` (npm/yarn 설치 후)
// 프로젝트에서 사용 중인 TypeScript 컴파일러로 순수 분류 모듈을 실행해 검증.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/quizUnits.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'quizUnits.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true
});
if (compiled.diagnostics?.length) throw Error('quizUnits.ts에 TypeScript 컴파일 진단이 있습니다.');
const localModule = { exports: {} };
new Function('module', 'exports', compiled.outputText)(localModule, localModule.exports);
const {makeOfficialUnitAliases, classifyQuizUnit, SHUFFLE_UNIT_ID, FUSION_UNIT_ID} = localModule.exports;

const unitNames = ['fine', 'Trickstar', '유성대', 'ALKALOID', 'Eden', 'Valkyrie', '2wink', 'Crazy:B', 'UNDEAD', 'Ra*bits', '홍월', 'MELLOW DEAR US', 'Knights', 'Switch', 'MaM', 'Special for Princess!'];
const groups = unitNames.map(id => ({ id, names: id === '홍월' ? { en: 'Akatsuki', ja: '紅月' } : {} }));
const official = makeOfficialUnitAliases(groups);
const fixtures = [
  ['fine', 'fine'], ['Trickstar', 'Trickstar'], ['trickstar', 'Trickstar'],
  ['Ra*bits', 'Ra*bits'], ['Special for Princess!', 'Special for Princess!'],
  ['紅月', '홍월'], ['Akatsuki', '홍월'],
  ['√AtoZ', SHUFFLE_UNIT_ID], ['XXVeil', SHUFFLE_UNIT_ID], ['Branco', SHUFFLE_UNIT_ID],
  ['月都スペクタクル', SHUFFLE_UNIT_ID], ['La Mort', SHUFFLE_UNIT_ID],
  ['Puffy☆Bunny', SHUFFLE_UNIT_ID], ['Flambé！', SHUFFLE_UNIT_ID],
  ['EVIL NUM+', SHUFFLE_UNIT_ID], ['SPRINT・ING!', SHUFFLE_UNIT_ID],
  ['Cascade of…', SHUFFLE_UNIT_ID], ['瑠璃茉莉', SHUFFLE_UNIT_ID],
  ['null', SHUFFLE_UNIT_ID], ['Ring.A.Bell', SHUFFLE_UNIT_ID], ['MODE/D', SHUFFLE_UNIT_ID],
  ['Crazy:B & UNDEAD', FUSION_UNIT_ID], ['UNDEAD × 紅月', FUSION_UNIT_ID],
  ['紅月 VS Crazy:B', FUSION_UNIT_ID], ['UNDEAD x Akatsuki', FUSION_UNIT_ID],
  ['Valkyrie&2wink', FUSION_UNIT_ID], ['퓨전곡', FUSION_UNIT_ID],
  ['Fusion Songs', FUSION_UNIT_ID], ['셔플곡', SHUFFLE_UNIT_ID],
  // 그냥 ×가 포함됐다는 이유만으로 퓨전곡으로 분류하면 안 됨
  ['Boys×Girls', SHUFFLE_UNIT_ID], ['Crazy:B vs MysteryUnit', SHUFFLE_UNIT_ID]
];
for (const [unitName, expected] of fixtures) {
  assert.equal(classifyQuizUnit(unitName, official), expected, `분류 실패: ${unitName}`);
}
console.log(`퀴즈 유닛 분류 테스트 ${fixtures.length}개 통과`);
