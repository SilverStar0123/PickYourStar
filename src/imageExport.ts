import html2canvas from "html2canvas";
import { IMAGE_SCALE } from "./types";
import type { Agency, Member, Picks } from "./types";

// ───────────────────────── 이미지 렌더링 및 저장 ─────────────────────────
export async function renderOnce(target: HTMLElement, scale: number): Promise<Blob> {
  const canvas = await html2canvas(target, {
    useCORS: true,
    scale,
    backgroundColor: "#ffffff",
    logging: false,
    imageTimeout: 10000
  });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 실패"))), "image/png")
  );
}

// 화면의 한 영역을 PNG(Blob)로 만듦. expand=true면 가로 스크롤 영역을 전부 펼쳐서 캡처
export async function renderToBlob(target: HTMLElement, expand: boolean): Promise<Blob> {
  const originalOverflow = target.style.overflow;
  const originalWidth = target.style.width;
  if (expand) {
    target.style.overflow = "visible";
    target.style.width = `${target.scrollWidth}px`;
  }
  try {
    try {
      return await renderOnce(target, IMAGE_SCALE);
    } catch (err) {
      console.warn("2배 해상도 저장 실패, 낮춰서 다시 시도:", err);
      return await renderOnce(target, 1);
    }
  } finally {
    if (expand) {
      target.style.overflow = originalOverflow;
      target.style.width = originalWidth;
    }
  }
}

// ── 개인 취향표 이미지: html2canvas 없이 캔버스에 직접 그림 (모바일/앱 안 브라우저에서도 안정적) ──
export function loadImage(src: string, fallback?: string): Promise<HTMLImageElement | null> {
  const tryLoad = (u: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      const timer = setTimeout(() => resolve(null), 8000);
      im.onload = () => {
        clearTimeout(timer);
        resolve(im);
      };
      im.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      if (!/^data:/i.test(u)) im.crossOrigin = "anonymous";
      im.src = u;
    });
  return tryLoad(src).then((im) => im ?? (fallback ? tryLoad(fallback) : null));
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderPersonalBlob(
  agencies: Agency[],
  picks: Picks,
  memberMap: Record<string, Member>,
  title: string
): Promise<Blob> {
  // styles.css의 .personal-card 와 같은 크기/간격 (화면 미리보기와 같은 모양)
  const W = 560, PAD = 24, GRID_GAP = 14, BOX_PAD = 12, PICK_GAP = 10, SLOT = 106, LOGO_H = 40;
  const NAME_LH = 15.6, UNIT_H = 13;
  const boxW = (W - PAD * 2 - GRID_GAP) / 2;
  const colW = (boxW - BOX_PAD * 2 - PICK_GAP) / 2;
  const NAME_FONT = "bold 12px sans-serif";

  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("canvas 미지원");
  const mctx: CanvasRenderingContext2D = probe;
  mctx.font = NAME_FONT;
  const wrap = (text: string, maxW: number): string[] => {
    const lines: string[] = [];
    let cur = "";
    const pushLong = (word: string) => {
      Array.from(word).forEach((ch) => {
        if (cur && mctx.measureText(cur + ch).width > maxW) {
          lines.push(cur);
          cur = ch;
        } else cur += ch;
      });
    };
    text
      .split(" ")
      .filter(Boolean)
      .forEach((word) => {
        const trial = cur ? `${cur} ${word}` : word;
        if (mctx.measureText(trial).width <= maxW) cur = trial;
        else if (!cur) pushLong(word);
        else {
          lines.push(cur);
          cur = "";
          pushLong(word);
        }
      });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  // 이미지 미리 불러오기
  const logos = await Promise.all(agencies.map((a) => loadImage(a.logo)));
  const pickImgs = await Promise.all(
    agencies.map((a) =>
      Promise.all(
        a.groups.map((g) => {
          const m = memberMap[picks[g.id]];
          return m && m.groupId === g.id ? loadImage(m.img, m.fallback) : Promise.resolve(null);
        })
      )
    )
  );

  // 높이 계산
  const pickLines = agencies.map((a) =>
    a.groups.map((g) => {
      const m = memberMap[picks[g.id]];
      return m && m.groupId === g.id ? wrap(m.name, colW) : [""];
    })
  );
  const rowHeights = agencies.map((a, ai) => {
    const rows: number[] = [];
    a.groups.forEach((_, gi) => {
      const r = Math.floor(gi / 2);
      const h = SLOT + 5 + pickLines[ai][gi].length * NAME_LH + UNIT_H;
      rows[r] = Math.max(rows[r] || 0, h);
    });
    return rows;
  });
  const boxHeights = rowHeights.map(
    (rows) => BOX_PAD * 2 + LOGO_H + 10 + rows.reduce((x, y) => x + y, 0) + PICK_GAP * Math.max(0, rows.length - 1)
  );
  const gridRows = Math.ceil(agencies.length / 2);
  const gridRowH: number[] = [];
  boxHeights.forEach((h, i) => {
    const r = Math.floor(i / 2);
    gridRowH[r] = Math.max(gridRowH[r] || 0, h);
  });
  const TITLE_H = 24;
  const H = PAD + TITLE_H + 18 + gridRowH.reduce((x, y) => x + y, 0) + GRID_GAP * Math.max(0, gridRows - 1) + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * IMAGE_SCALE);
  canvas.height = Math.round(H * IMAGE_SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 미지원");
  ctx.scale(IMAGE_SCALE, IMAGE_SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#333333";
  ctx.font = "bold 20.8px sans-serif";
  ctx.fillText(title, W / 2, PAD + TITLE_H / 2, W - PAD * 2);

  agencies.forEach((agency, ai) => {
    const col = ai % 2;
    const gr = Math.floor(ai / 2);
    const bx = PAD + col * (boxW + GRID_GAP);
    const by = PAD + TITLE_H + 18 + gridRowH.slice(0, gr).reduce((x, y) => x + y + GRID_GAP, 0);

    ctx.fillStyle = "#f8f9fa";
    roundRectPath(ctx, bx, by, boxW, gridRowH[gr], 12);
    ctx.fill();

    // 소속사 로고 (비율 유지, 칸 안에 맞춤)
    const logo = logos[ai];
    const innerW = boxW - BOX_PAD * 2;
    if (logo && logo.naturalWidth && logo.naturalHeight) {
      const sc = Math.min(LOGO_H / logo.naturalHeight, innerW / logo.naturalWidth);
      const dw = logo.naturalWidth * sc;
      const dh = logo.naturalHeight * sc;
      ctx.drawImage(logo, bx + boxW / 2 - dw / 2, by + BOX_PAD + (LOGO_H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = "#444444";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(agency.name, bx + boxW / 2, by + BOX_PAD + LOGO_H / 2, innerW);
    }

    agency.groups.forEach((g, gi) => {
      const pc = gi % 2;
      const pr = Math.floor(gi / 2);
      const cx = bx + BOX_PAD + pc * (colW + PICK_GAP) + colW / 2;
      const ry =
        by + BOX_PAD + LOGO_H + 10 + rowHeights[ai].slice(0, pr).reduce((x, y) => x + y + PICK_GAP, 0);
      const sx = cx - SLOT / 2;

      // 사진 칸 (둥근 모서리, 가운데 기준 정사각형으로 채움)
      ctx.save();
      roundRectPath(ctx, sx, ry, SLOT, SLOT, 10);
      ctx.clip();
      ctx.fillStyle = "#e9ecef";
      ctx.fillRect(sx, ry, SLOT, SLOT);
      const im = pickImgs[ai][gi];
      if (im && im.naturalWidth && im.naturalHeight) {
        const side = Math.min(im.naturalWidth, im.naturalHeight);
        ctx.drawImage(
          im,
          (im.naturalWidth - side) / 2,
          (im.naturalHeight - side) / 2,
          side,
          side,
          sx,
          ry,
          SLOT,
          SLOT
        );
      } else {
        ctx.fillStyle = "#adb5bd";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("?", cx, ry + SLOT / 2);
      }
      ctx.restore();

      // 이름 / 유닛
      const lines = pickLines[ai][gi];
      ctx.fillStyle = "#444444";
      ctx.font = NAME_FONT;
      lines.forEach((ln, k) => ctx.fillText(ln, cx, ry + SLOT + 5 + NAME_LH * (k + 0.5)));
      ctx.fillStyle = "#999999";
      ctx.font = "10.4px sans-serif";
      ctx.fillText(g.name, cx, ry + SLOT + 5 + lines.length * NAME_LH + UNIT_H / 2, colW);
    });
  });

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 실패"))), "image/png")
  );
}

export function triggerDownload(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
