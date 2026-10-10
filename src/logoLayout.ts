// 결과표 맨 위 유닛 로고 크기 계산
// - 로고마다 가로세로 비율이 달라서, 칸에 똑같이 넣으면 정사각형은 커 보이고 긴 로고는 작아 보임
// - 그래서 "면적"을 비슷하게 맞추고, 이웃 로고와 겹치지 않게 조정함

export interface LogoBox {
  w: number;
  h: number;
}

interface LayoutOptions {
  pitch: number; // 칸 중심 사이 거리 (사진 칸 + 간격)
  targetArea?: number; // 로고 하나가 차지할 목표 면적(px²)
  maxHeight?: number; // 로고 최대 높이
  maxWidthRatio?: number; // 한 칸(pitch) 대비 최대 폭 배수
  minGap?: number; // 이웃 로고와의 최소 간격(px)
}

export function layoutLogos(ratios: number[], opts: LayoutOptions): LogoBox[] {
  const { pitch, targetArea = 3200, maxHeight = 58, maxWidthRatio = 1.45, minGap = 8 } = opts;
  const maxW = pitch * maxWidthRatio;

  // 1) 면적을 맞추되, 높이/폭 상한 적용
  const boxes: LogoBox[] = ratios.map((raw) => {
    const r = raw > 0 && isFinite(raw) ? raw : 1;
    let h = Math.sqrt(targetArea / r);
    let w = h * r;
    if (h > maxHeight) {
      h = maxHeight;
      w = h * r;
    }
    if (w > maxW) {
      w = maxW;
      h = w / r;
    }
    return { w, h };
  });

  // 2) 이웃과 겹치면 더 넓은 쪽을 줄임 (중심 간 거리가 pitch이므로 반폭의 합 ≤ pitch - minGap)
  const room = pitch - minGap;
  const setWidth = (i: number, w: number, r: number) => {
    boxes[i] = { w, h: w / r };
  };
  const rOf = (i: number) => (ratios[i] > 0 && isFinite(ratios[i]) ? ratios[i] : 1);

  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    for (let i = 0; i < boxes.length - 1; i++) {
      const need = boxes[i].w / 2 + boxes[i + 1].w / 2;
      if (need <= room + 0.01) continue;
      changed = true;
      const big = boxes[i].w >= boxes[i + 1].w ? i : i + 1;
      const small = big === i ? i + 1 : i;
      const newBig = 2 * room - boxes[small].w;
      if (newBig >= boxes[small].w) {
        setWidth(big, newBig, rOf(big));
      } else {
        // 둘 다 넓은 경우: 같은 폭으로 맞춤
        setWidth(big, room, rOf(big));
        setWidth(small, room, rOf(small));
      }
    }
    if (!changed) break;
  }
  return boxes;
}
