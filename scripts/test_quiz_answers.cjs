// 독립 테스트: TypeScript 파일만 transpile해 정답 비교 함수 실행 (Firebase/React 접속 없음).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
let ts;
try { ts = require('typescript'); }
catch {
  try { ts = require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript')); }
  catch { throw new Error('TypeScript 패키지를 찾지 못했습니다. npm install 후 다시 실행하세요.'); }
}
const filename = path.join(__dirname, '..', 'src', 'quizAnswer.ts');
const source = fs.readFileSync(filename, 'utf8');
const result = ts.transpileModule(source, { compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019}, fileName: filename, reportDiagnostics: true });
assert.equal(result.diagnostics.length, 0, 'TypeScript 구문 검사');
const Module = module.constructor;
const m = new Module(filename, module);
m.filename = filename;
m.paths = module.paths;
m._compile(result.outputText, filename);
const {isCorrectGuess,normalizeAnswer, getAcceptedAnswers, SYMBOL_RULES} = m.exports;
let count = 0;
const song = (titleKo, titleEn='', titleJa='', aliases=[]) => ({ titleKo, titleEn, titleJa, aliases });
function check(title, candidate, expected, desc) {
  const actual = isCorrectGuess(candidate, title);
  assert.equal(actual, expected, `${desc}: ${JSON.stringify(candidate)} -> ${actual}`);
  count++;
}
const rebellion = song('Rebellion Star', 'Rebellion Star', 'Rebellion Star');
check(rebellion, 'rEbElLiOn   StAr', true, '대소문자 및 띄어쓰기 무시');
check(rebellion, 'REBELLIONSTAR', true, '공백 생략');
check(rebellion, 'Rebellion', false, '영문 철자는 정확히');
check(rebellion, 'Rebellion Stars', false, '다른 철자는 오답');
const meteor = song('천하무적☆메테오레인저!', 'Tenka Muteki Meteor Ranger', '天下無敵☆メテオレンジャー!');
check(meteor, '천하무적메테오레인저', true, '별 생략');
check(meteor, '천하무적★메테오레인저!', true, '별 변형');
check(meteor, '천하무적*메테오레인저', true, '별 별표 대체');
check(meteor, '天下無敵 メテオレンジャー', true, '일본어 띄어쓰기/기호');
check(meteor, '천하무적메테오렌저', false, '한글 철자 오답');
const beater = song('HEART→BEATER!!!!');
check(beater, 'heartbeater', true, '화살표 생략');
check(beater, 'heart->beater', true, '화살표 -> 대체');
check(beater, 'HEART => BEATER!!', true, '화살표 => 대체');
check(beater, 'HEARTBEATERS', false, '화살표를 빼도 철자는 비교');
const hearts = song('Love♡Song');
check(hearts, 'love song', true, '하트 생략');
check(hearts, 'LOVE♥SONG', true, '하트 문자 대체');
check(hearts, 'Love <3 Song', true, '하트 <3 대체');
check(hearts, 'love < 3 song', true, '하트 < 3 대체');
check(hearts, 'LOVESONGS', false, '추가 영어 문자 불허');
const multiply = song('Daydream×Reality');
check(multiply, 'DaydreamReality', true, '× 생략');
check(multiply, 'Daydream x Reality', true, '× 영문 x 대체');
check(multiply, 'DAYDREAM×REALITY', true, '× 기호 원본');
check(multiply, 'Daydream z Reality', false, '허용되지 않은 대체 문자');
check(song('Xylophone'), 'ylophone', false, '원래 문자 x 삭제 금지');
check(song('Love Ra*bits Party!!'), 'love rabits party', true, '기존 구두점 제거 동작 유지');
check(song('U.S.A.'), 'usa', true, '퓨전곡의 점(.) 생략');
check(song('U.S.A.'), 'us', false, '원래 영문 철자 누락 불허');
check(song('제목 (부제)'), '제목', true, '기존 괄호 부제 생략');
check(song('元タイトル', 'English Title', '日本語の題', ['별칭']), '별칭', true, '기존 별칭 인정');
check(song('元タイトル', 'English Title', '日本語の題', ['별칭']), 'EnglishTitle', true, '기존 언어별 제목 인정');
check(song('元タイトル', 'English Title', '日本語の題', ['별칭']), '日本語の題', true, '기존 일본어 제목 인정');
check(song('STAR'), '*', false, '기호만 입력으로 정답 처리 금지');
check(song('STAR'), 'STAR', true, '정상 정답');
assert.equal(normalizeAnswer('Love <3 Song'), 'lovesong');
assert.ok(SYMBOL_RULES.length >= 6);
console.log(`✅ 하드/초보자 공통 정답 보정 테스트 ${count}개 + 설정 검사 통과`);
