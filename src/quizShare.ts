// 노래 맞추기 결과 공유: 결과 이미지 그리기, 공유 링크, X(트위터) 글쓰기 주소
// 서버(Firebase)를 쓰지 않으므로 사용량이 늘지 않습니다.

export interface QuizResultInfo {
  correct: number;
  total: number;
  easy: boolean; // true = 초보자 모드, false = 하드 모드
  score?: number; // 최종 점수 (0~100). 예전 링크에는 없을 수 있음
}

// X 게시글에 자동으로 붙일 해시태그 ("#" 없이). X 공유 버튼과 모바일 기본 공유에서 공통 사용합니다.
export const QUIZ_SHARE_HASHTAGS: string[] = ["앙스타1초노래맞추기"];

// 휴대폰 공유 메뉴(X 앱 선택 포함)는 Web Intent의 hashtags 파라미터를 사용하지 않으므로 본문에 직접 덧붙입니다.
export function buildQuizNativeShareText(text: string): string {
  const tags = QUIZ_SHARE_HASHTAGS.map((tag) => `#${tag}`).join(" ");
  return tags ? `${text}\n\n${tags}` : text;
}

// 공유 링크: 기록이 주소(#/quiz?r=맞힌수-문제수-모드[-점수])에 담김. 받은 사람은 설정 화면에서 안내 문구를 봄
export function buildQuizShareUrl(r: QuizResultInfo): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  const score = typeof r.score === "number" ? `-${Math.max(0, Math.min(100, Math.round(r.score)))}` : "";
  return `${base}#/quiz?r=${r.correct}-${r.total}-${r.easy ? "e" : "h"}${score}`;
}

// 주소의 해시에서 친구 기록을 읽음. 형식이 맞지 않거나 말이 안 되는 숫자면 무시(주소는 누구나 고칠 수 있으므로 검증)
export function parseQuizChallenge(hash: string): QuizResultInfo | null {
  const q = hash.split("?")[1];
  if (!q) return null;
  const m = /^(\d{1,3})-(\d{1,3})-([eh])(?:-(\d{1,3}))?$/.exec(new URLSearchParams(q).get("r") || "");
  if (!m) return null;
  const correct = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1 || total > 100 || correct > total) return null;
  const score = m[4] === undefined ? undefined : Number(m[4]);
  if (score !== undefined && score > 100) return null;
  return score === undefined ? { correct, total, easy: m[3] === "e" } : { correct, total, easy: m[3] === "e", score };
}

// X 글쓰기 창 주소 (공식 Web Intent). 이미지는 이 주소로 첨부할 수 없어서 글과 링크만 채워 줍니다.
export function buildTweetIntentUrl(o: { text: string; url: string; hashtags?: string[] }): string {
  let q = `text=${encodeURIComponent(o.text)}&url=${encodeURIComponent(o.url)}`;
  if (o.hashtags && o.hashtags.length > 0) q += `&hashtags=${encodeURIComponent(o.hashtags.join(","))}`;
  return `https://x.com/intent/tweet?${q}`;
}

// 결과 이미지용 기록 통계. 모든 판정은 각 문제의 실제 재생 횟수를 기준으로 합니다.
export interface QuizPlayRecord {
  correct: boolean;
  listens: number;
  tries: number;
  title: string;
}

export interface QuizPlaySummary {
  once: number; // 정확히 한 번 재생한 뒤 정답
  repeated: number; // 두 번 이상 재생한 뒤 정답
  unanswered: number; // 오답/포기
  noAudio: number; // 재생하지 않고 맞힌 정답 (별도 안내)
  hardest: { title: string; listens: number; tries: number } | null;
}

export function summarizeQuizPlayRecords(records: QuizPlayRecord[]): QuizPlaySummary {
  let once = 0;
  let repeated = 0;
  let unanswered = 0;
  let noAudio = 0;
  let hardest: QuizPlaySummary["hardest"] = null;

  records.forEach((r) => {
    if (!r.correct) {
      unanswered += 1;
      return;
    }
    const listens = Number.isFinite(r.listens) ? Math.max(0, Math.trunc(r.listens)) : 0;
    const tries = Number.isFinite(r.tries) ? Math.max(0, Math.trunc(r.tries)) : 0;
    if (listens === 0) noAudio += 1;
    else if (listens === 1) once += 1;
    else repeated += 1;

    // 가장 많은 횟수로 재생한 정답. 재생 횟수가 같으면 더 많이 시도한 곡을 선택.
    if (!hardest || listens > hardest.listens || (listens === hardest.listens && tries > hardest.tries)) {
      hardest = { title: r.title, listens, tries };
    }
  });
  return { once, repeated, unanswered, noAudio, hardest };
}

export interface ResultCardText {
  title: string;
  rateLabel: string;
  detail: string;
  modeLabel: string;
  scoreText: string;
  footer: string;
  percent: number;
  stats: QuizPlaySummary;
  statsTitle: string;
  onceLabel: string;
  repeatedLabel: string;
  unansweredLabel: string;
  songsUnit: string;
  noAudioNote: string; // 이미 건너뛰지 않고 맞혔지만 재생 횟수가 0인 경우
  hardestTitle: string;
  hardestEmpty: string;
  hardestMeta: string;
}

const FONT = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Noto Sans JP","Hiragino Sans",sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 공백 기준으로 줄바꿈(한 단어가 너무 길면 글자 단위), 최대 줄 수를 넘으면 말줄임
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const push = (ch: string) => {
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  };
  text.split(" ").forEach((word, i) => {
    const trial = cur ? `${cur} ${word}` : word;
    if (i > 0 && ctx.measureText(trial).width <= maxW) cur = trial;
    else {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      Array.from(word).forEach(push);
    }
  });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/.{1}$/, "…");
    return kept;
  }
  return lines;
}

// 한 줄에 들어가도록 끝을 "…"로 줄임
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join("") + "…").width > maxW) chars.pop();
  return chars.join("") + "…";
}

// 결과 카드를 2배 해상도 PNG로 그림 (서버나 Firestore 요청 없음)
// 상단 정답률/점수는 유지하고, 하단은 실제 문제별 재생 기록으로 표시합니다.
export function renderQuizResultBlob(c: ResultCardText): Promise<Blob> {
  const W = 1200;
  const H = 980;
  const S = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas 미지원"));
  ctx.scale(S, S);

  // 배경
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#ffe3e3");
  bg.addColorStop(1, "#fff5f5");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 흰 카드
  ctx.save();
  ctx.shadowColor = "rgba(255,107,107,0.28)";
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 48, 48, W - 96, H - 96, 36);
  ctx.fill();
  ctx.restore();

  // 정답률 링
  const cx = 270;
  const cy = 262;
  const r = 128;
  const p = Math.max(0, Math.min(100, c.percent)) / 100;
  ctx.lineWidth = 30;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#f1f3f5";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (p > 0) {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, "#ff8787");
    g.addColorStop(1, "#ff6b6b");
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();
  }

  // 링 가운데 글자
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 92px ${FONT}`;
  const numW = ctx.measureText(String(c.percent)).width;
  ctx.font = `800 42px ${FONT}`;
  const pctW = ctx.measureText("%").width;
  const startX = cx - (numW + pctW + 4) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2933";
  ctx.font = `800 92px ${FONT}`;
  ctx.fillText(String(c.percent), startX, cy + 28);
  ctx.font = `800 42px ${FONT}`;
  ctx.fillText("%", startX + numW + 4, cy + 28);
  ctx.textAlign = "center";
  ctx.fillStyle = "#6b7785";
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(c.rateLabel, cx, cy + 72, 190);

  // 오른쪽 제목·점수
  const x0 = 470;
  const maxW = 620;
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2933";
  ctx.font = `800 40px ${FONT}`;
  const titleLines = wrapLines(ctx, c.title, maxW, 2);
  let y = 150;
  titleLines.forEach((ln) => {
    ctx.fillText(ln, x0, y);
    y += 50;
  });

  ctx.font = `700 24px ${FONT}`;
  const pillW = Math.min(maxW, ctx.measureText(c.modeLabel).width + 40);
  ctx.fillStyle = "#fff1f1";
  roundRect(ctx, x0, y - 18, pillW, 44, 22);
  ctx.fill();
  ctx.fillStyle = "#e8505b";
  ctx.fillText(c.modeLabel, x0 + 20, y + 13, pillW - 28);
  y += 76;

  ctx.fillStyle = "#1f2933";
  ctx.font = `800 34px ${FONT}`;
  wrapLines(ctx, c.detail, maxW, 2).forEach((ln) => {
    ctx.fillText(ln, x0, y);
    y += 46;
  });
  ctx.fillStyle = "#e8505b";
  ctx.font = `800 42px ${FONT}`;
  ctx.fillText(c.scoreText, x0, y + 8, maxW);

  // 구분선 및 플레이 기록 타이틀
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = "#e4e8ee";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 452);
  ctx.lineTo(W - 96, 452);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2933";
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(c.statsTitle, 96, 507, 680);

  if (c.stats.noAudio > 0) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#86909c";
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText(c.noAudioNote, W - 96, 505, 420);
  }

  // 플레이 방식별 3개 수치 카드
  const tiles = [
    { count: c.stats.once, label: c.onceLabel, color: "#f05d69", bg: "#fff3f4" },
    { count: c.stats.repeated, label: c.repeatedLabel, color: "#9469c8", bg: "#f7f3ff" },
    { count: c.stats.unanswered, label: c.unansweredLabel, color: "#7c8795", bg: "#f5f7fa" }
  ];
  const tileX = 96;
  const tileY = 540;
  const tileW = 324;
  const tileGap = 18;
  const tileH = 174;
  tiles.forEach((t, i) => {
    const x = tileX + (tileW + tileGap) * i;
    ctx.fillStyle = t.bg;
    roundRect(ctx, x, tileY, tileW, tileH, 20);
    ctx.fill();
    ctx.fillStyle = t.color;
    roundRect(ctx, x + 18, tileY + 18, 7, 29, 3);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = "#4b5563";
    ctx.fillText(fitText(ctx, t.label, tileW - 60), x + 40, tileY + 43);
    ctx.font = `800 67px ${FONT}`;
    ctx.fillStyle = t.color;
    const countText = String(t.count);
    ctx.fillText(countText, x + 31, tileY + 130);
    const countW = ctx.measureText(countText).width;
    ctx.font = `700 25px ${FONT}`;
    ctx.fillText(c.songsUnit, x + 36 + countW, tileY + 127, tileW - countW - 60);
  });

  // 가장 오래 고민한 정답: 가장 많이 재생한 정답 곡을 한 곡만 표시
  const panelX = 96;
  const panelY = 750;
  const panelW = W - 192;
  const panelH = 128;
  ctx.fillStyle = "#fff7f6";
  roundRect(ctx, panelX, panelY, panelW, panelH, 20);
  ctx.fill();
  ctx.fillStyle = "#e8505b";
  roundRect(ctx, panelX + 24, panelY + 20, 7, 24, 3);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#52606d";
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(c.hardestTitle, panelX + 45, panelY + 42, panelW - 85);

  if (c.stats.hardest) {
    ctx.fillStyle = "#1f2933";
    ctx.font = `800 31px ${FONT}`;
    ctx.fillText(fitText(ctx, c.stats.hardest.title, 615), panelX + 26, panelY + 96);
    ctx.textAlign = "right";
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = "#d35461";
    ctx.fillText(fitText(ctx, c.hardestMeta, 320), panelX + panelW - 24, panelY + 96);
  } else {
    ctx.fillStyle = "#7b8794";
    ctx.font = `600 25px ${FONT}`;
    ctx.fillText(fitText(ctx, c.hardestEmpty, panelW - 52), panelX + 26, panelY + 96);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#98a2b3";
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(c.footer, W / 2, H - 62, W - 200);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 실패"))), "image/png")
  );
}
