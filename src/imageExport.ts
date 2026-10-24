import type { Agency, Member, Picks } from "./types";
import { IMAGE_SCALE } from "./config";
import html2canvas from "html2canvas";
import { groupSpecialUnits, type PickSheetId } from "./pickSheets";
import type { Lang } from "./i18n";

// ───────────────────────── 이미지 렌더링 및 저장 ─────────────────────────
async function renderOnce(target: HTMLElement, scale: number): Promise<Blob> {
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
function loadImage(src: string, fallback?: string): Promise<HTMLImageElement | null> {
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

function roundRectPath(
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

// 스페셜/Shuffle 등 한 종류의 유닛을 여러 장 선택하는 취향표 전용 이미지.
// 기존 2열 소속사 레이아웃에서는 소속사가 하나일 때 오른쪽 절반이 비고 이미지가 길어집니다.
// 이 레이아웃은 유닛 카드 4열로 전체 너비를 사용합니다.
async function renderCollectionBlob(
  agencies: Agency[],
  picks: Picks,
  memberMap: Record<string, Member>,
  title: string,
  collectionName: string
): Promise<Blob> {
  const groups = agencies.flatMap((a) => a.groups);
  const W = 800;
  const PAD = 32;
  const GAP = 14;
  const COLS = 4;
  const CARD_W = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const CARD_H = 233;
  const PHOTO = 132;
  const HEADER_H = 125;
  const rows = Math.ceil(groups.length / COLS);
  const H = PAD + HEADER_H + rows * CARD_H + Math.max(0, rows - 1) * GAP + PAD;

  const images = await Promise.all(groups.map((g) => {
    const member = memberMap[picks[g.id]];
    return member && member.groupId === g.id
      ? loadImage(member.img, member.fallback)
      : Promise.resolve(null);
  }));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * IMAGE_SCALE);
  canvas.height = Math.round(H * IMAGE_SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 미지원");
  ctx.scale(IMAGE_SCALE, IMAGE_SCALE);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fffafb";
  ctx.fillRect(0, 0, W, H);

  // 과한 대형 로고 대신 가벼운 헤더와 소분류 표시.
  ctx.fillStyle = "#c66b84";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("PICKYOURS · PERSONAL COLLECTION", W / 2, PAD + 12);
  ctx.fillStyle = "#342e37";
  ctx.font = "bold 29px sans-serif";
  ctx.fillText(title, W / 2, PAD + 48, W - PAD * 2);
  ctx.fillStyle = "#aa697d";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText(collectionName, W / 2, PAD + 82, W - PAD * 2);

  const selected = groups.filter((g) => memberMap[picks[g.id]]?.groupId === g.id).length;
  ctx.fillStyle = "#92838d";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${selected} / ${groups.length} SELECTED`, W / 2, PAD + 105);

  groups.forEach((group, i) => {
    const member = memberMap[picks[group.id]];
    const picked = member?.groupId === group.id ? member : null;
    const col = i % COLS, row = Math.floor(i / COLS);
    const bx = PAD + col * (CARD_W + GAP);
    const by = PAD + HEADER_H + row * (CARD_H + GAP);
    const cx = bx + CARD_W / 2;

    ctx.fillStyle = "#ffffff";
    roundRectPath(ctx, bx, by, CARD_W, CARD_H, 14);
    ctx.fill();
    ctx.strokeStyle = "#eee3e9";
    ctx.lineWidth = 1;
    ctx.stroke();

    const x = cx - PHOTO / 2, y = by + 14;
    ctx.save();
    roundRectPath(ctx, x, y, PHOTO, PHOTO, 11);
    ctx.clip();
    ctx.fillStyle = "#f4eef1";
    ctx.fillRect(x, y, PHOTO, PHOTO);
    const im = images[i];
    if (im && im.naturalWidth && im.naturalHeight) {
      const side = Math.min(im.naturalWidth, im.naturalHeight);
      ctx.drawImage(im,
        (im.naturalWidth - side) / 2,
        (im.naturalHeight - side) / 2,
        side, side, x, y, PHOTO, PHOTO);
    } else {
      ctx.fillStyle = "#b9aab6";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText("?", cx, y + PHOTO / 2);
    }
    ctx.restore();

    // 글자가 긴 팀(예: team 우시와카마루)은 넘치지 않도록 Canvas가 너비를 맞춰 줍니다.
    ctx.fillStyle = picked ? "#3e3840" : "#a8a0a7";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(picked?.name || "—", cx, by + 167, CARD_W - 15);
    ctx.fillStyle = "#b2637f";
    ctx.font = "12px sans-serif";
    ctx.fillText(group.name, cx, by + 195, CARD_W - 14);
  });

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 실패"))), "image/png")
  );
}

// 스페셜 유닛 전용: 유닛을 세 섹션으로 묶고, 유닛명을 캐릭터 이름보다 위에 배치합니다.
// 같은 캐릭터가 여러 유닛에서 반복되어도 어느 유닛의 선택인지 바로 알 수 있습니다.
async function renderSpecialCollectionBlob(
  agencies: Agency[],
  picks: Picks,
  memberMap: Record<string, Member>,
  title: string,
  collectionName: string,
  lang: Lang
): Promise<Blob> {
  const groups = agencies.flatMap((agency) => agency.groups);
  // '나의 취향표' 화면과 PNG가 같은 유닛 묶음/표시 순서를 사용합니다.
  const sections = groupSpecialUnits(groups, lang);

  const WIDTH = 1080;
  const OUTER = 42;
  const CONTENT_W = WIDTH - OUTER * 2;
  const CARD_GAP = 12;
  const CARD_H = 220;
  const GROUP_HEAD_H = 50;
  const GROUP_PAD = 16;
  const GROUP_GAP = 20;
  const HEADER_H = 137;
  const FOOTER_H = 30;
  // 향후 스페셜 유닛이 늘어나도 카드가 너무 작아지지 않게 최대 6열로 제한.
  const columnsFor = (count: number) => Math.min(6, Math.max(5, count));
  const rowsFor = (count: number) => Math.ceil(count / columnsFor(count));
  const sectionHeight = (count: number) =>
    GROUP_HEAD_H + rowsFor(count) * CARD_H +
    Math.max(0, rowsFor(count) - 1) * CARD_GAP + GROUP_PAD * 2;
  const HEIGHT = OUTER + HEADER_H + sections.reduce(
    (total, section) => total + sectionHeight(section.groups.length), 0
  ) + Math.max(0, sections.length - 1) * GROUP_GAP + FOOTER_H + OUTER;

  const imagesById = new Map<string, HTMLImageElement | null>();
  await Promise.all(groups.map(async (group) => {
    const member = memberMap[picks[group.id]];
    imagesById.set(group.id, member && member.groupId === group.id
      ? await loadImage(member.img, member.fallback) : null);
  }));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(WIDTH * IMAGE_SCALE);
  canvas.height = Math.round(HEIGHT * IMAGE_SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 미지원");
  ctx.scale(IMAGE_SCALE, IMAGE_SCALE);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff9fb";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const selected = groups.filter((group) => memberMap[picks[group.id]]?.groupId === group.id).length;
  ctx.fillStyle = "#b65a77";
  ctx.font = "700 14px sans-serif";
  ctx.fillText("PICKYOURS · PERSONAL COLLECTION", WIDTH / 2, OUTER + 9);
  ctx.fillStyle = "#352d36";
  ctx.font = "700 36px sans-serif";
  ctx.fillText(title, WIDTH / 2, OUTER + 49, CONTENT_W);
  ctx.fillStyle = "#ad5877";
  ctx.font = "700 17px sans-serif";
  ctx.fillText(collectionName, WIDTH / 2, OUTER + 84);
  ctx.fillStyle = "#847580";
  ctx.font = "14px sans-serif";
  ctx.fillText(`${selected} / ${groups.length} SELECTED`, WIDTH / 2, OUTER + 113);

  let cursorY = OUTER + HEADER_H;
  sections.forEach((section, sectionIndex) => {
    const groupX = OUTER;
    const sectionY = cursorY;
    const groupHeight = sectionHeight(section.groups.length);
    // 같은 섹션에 속한 선택들을 하나의 판 위에 묶되 색을 과하게 늘리지 않습니다.
    ctx.fillStyle = "#ffffff";
    roundRectPath(ctx, groupX, sectionY, CONTENT_W, groupHeight, 20);
    ctx.fill();
    ctx.strokeStyle = "#eee2e8";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const left = groupX + GROUP_PAD;
    const titleY = sectionY + GROUP_PAD + 18;
    ctx.fillStyle = "#ac5772";
    roundRectPath(ctx, left, titleY - 15, 39, 30, 8);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 15px sans-serif";
    ctx.fillText(String(sectionIndex + 1).padStart(2, "0"), left + 19.5, titleY);

    ctx.textAlign = "left";
    ctx.fillStyle = "#453741";
    ctx.font = "700 20px sans-serif";
    ctx.fillText(section.title, left + 54, titleY);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ab9aa4";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${section.groups.length} UNITS`, WIDTH - OUTER - GROUP_PAD, titleY);
    ctx.textAlign = "center";

    const count = section.groups.length;
    const columns = columnsFor(count);
    const cardW = (CONTENT_W - GROUP_PAD * 2 - CARD_GAP * (columns - 1)) / columns;
    section.groups.forEach((group, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const by = sectionY + GROUP_HEAD_H + GROUP_PAD + row * (CARD_H + CARD_GAP);
      const member = memberMap[picks[group.id]];
      const picked = member?.groupId === group.id ? member : null;
      const bx = OUTER + GROUP_PAD + col * (cardW + CARD_GAP);
      const cx = bx + cardW / 2;

      // 유닛명을 카드 맨 위의 진한 라벨로 고정: 캐릭터가 중복되어도 구분 가능.
      ctx.fillStyle = "#fefbfc";
      roundRectPath(ctx, bx, by, cardW, CARD_H, 13);
      ctx.fill();
      ctx.strokeStyle = "#eee6ea";
      ctx.stroke();
      ctx.fillStyle = "#f6e7ed";
      roundRectPath(ctx, bx + 7, by + 7, cardW - 14, 38, 8);
      ctx.fill();
      ctx.fillStyle = "#8e3958";
      ctx.font = `700 ${columns > 5 ? 12 : 14}px sans-serif`;
      ctx.fillText(group.name, cx, by + 26, cardW - 25);

      const photo = Math.min(123, cardW - 28);
      const px = cx - photo / 2;
      const py = by + 51;
      ctx.save();
      roundRectPath(ctx, px, py, photo, photo, 10);
      ctx.clip();
      ctx.fillStyle = "#f0eaf0";
      ctx.fillRect(px, py, photo, photo);
      const img = imagesById.get(group.id);
      if (img && img.naturalWidth && img.naturalHeight) {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - side) / 2,
          (img.naturalHeight - side) / 2, side, side,
          px, py, photo, photo);
      } else {
        ctx.fillStyle = "#aca0a9";
        ctx.font = "700 23px sans-serif";
        ctx.fillText(picked ? "?" : "—", cx, py + photo / 2);
      }
      ctx.restore();

      ctx.fillStyle = picked ? "#39343b" : "#aca1a9";
      ctx.font = `700 ${columns > 5 ? 13 : 15}px sans-serif`;
      ctx.fillText(picked?.name || (lang === "ko" ? "미선택" : "—"),
        cx, by + 196, cardW - 16);
    });

    cursorY += groupHeight + GROUP_GAP;
  });

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("toBlob 실패")), "image/png")
  );
}

export async function renderPersonalBlob(
  agencies: Agency[],
  picks: Picks,
  memberMap: Record<string, Member>,
  title: string,
  collectionName?: string,
  sheetId?: PickSheetId,
  lang: Lang = "ko"
): Promise<Blob> {
  if (sheetId === "special" && collectionName) {
    return renderSpecialCollectionBlob(agencies, picks, memberMap, title, collectionName, lang);
  }
  if (collectionName) {
    return renderCollectionBlob(agencies, picks, memberMap, title, collectionName);
  }
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
