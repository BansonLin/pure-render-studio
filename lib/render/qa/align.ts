/**
 * AI 結果與底圖的粗對位（純函式）。
 *
 * 影像模型常輸出不同尺寸／略微重新構圖。回貼選區外像素前，先估計
 * 「等比縮放 + 平移」讓兩張圖對齊；殘差過大代表模型改了鏡位，此時不應回貼，
 * 改提示使用者「鏡位已變動」。
 */

export interface Gray {
  w: number;
  h: number;
  px: Float32Array;
}

/**
 * 對位參數定義：底圖像素 x 對應到結果圖位置 u = (x - cx - dx) / scale + cx（y 同理）。
 * 換言之，結果圖像素 u 應被放到底圖座標 x = scale·(u - cx) + cx + dx。
 */
export interface Alignment {
  /** 以底圖像素為單位的平移 */
  dx: number;
  dy: number;
  /** 結果圖相對底圖中心的縮放 */
  scale: number;
  /** 對齊後梯度殘差 / 未對齊殘差（越小越好；> 0.85 表示幾乎沒改善或內容差太多） */
  residual: number;
  /** 對齊後梯度相關（0..1） */
  similarity: number;
}

export function resizeGray(src: Gray, w: number, h: number): Gray {
  const out = new Float32Array(w * h);
  const sx = src.w / w;
  const sy = src.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let s = 0,
        n = 0;
      for (let yy = y0; yy < Math.min(src.h, y1); yy++)
        for (let xx = x0; xx < Math.min(src.w, x1); xx++) {
          s += src.px[yy * src.w + xx];
          n++;
        }
      out[y * w + x] = n ? s / n : 0;
    }
  }
  return { w, h, px: out };
}

function gradMag(g: Gray): Gray {
  const { w, h, px } = g;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = px[i + 1] - px[i - 1];
      const gy = px[i + w] - px[i - w];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  return { w, h, px: out };
}

function sampleAt(g: Gray, x: number, y: number) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= g.w || yi >= g.h) return -1;
  return g.px[yi * g.w + xi];
}

/** 以中心為原點縮放 s 並平移 (dx,dy) 後，比較 base 與 cand 的梯度差 */
function cost(base: Gray, cand: Gray, s: number, dx: number, dy: number, step: number) {
  const cx = base.w / 2;
  const cy = base.h / 2;
  let sum = 0,
    n = 0;
  const m = 3;
  for (let y = m; y < base.h - m; y += step)
    for (let x = m; x < base.w - m; x += step) {
      // base 像素 (x,y) 對應 cand 的位置
      const u = (x - cx - dx) / s + cx;
      const v = (y - cy - dy) / s + cy;
      const c = sampleAt(cand, u, v);
      if (c < 0) continue;
      sum += Math.abs(base.px[y * base.w + x] - c);
      n++;
    }
  return n ? sum / n : Infinity;
}

function similarity(base: Gray, cand: Gray, s: number, dx: number, dy: number) {
  const cx = base.w / 2;
  const cy = base.h / 2;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let y = 3; y < base.h - 3; y++)
    for (let x = 3; x < base.w - 3; x++) {
      const c = sampleAt(cand, (x - cx - dx) / s + cx, (y - cy - dy) / s + cy);
      if (c < 0) continue;
      const a = base.px[y * base.w + x];
      sab += a * c;
      saa += a * a;
      sbb += c * c;
    }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/**
 * @param base 底圖亮度（任意尺寸）
 * @param cand 結果亮度，已拉伸到與 base 相同長寬比
 */
export function estimateAlignment(base: Gray, cand: Gray): Alignment {
  const W1 = 160;
  const H1 = Math.max(16, Math.round((W1 * base.h) / base.w));
  const b1 = gradMag(resizeGray(base, W1, H1));
  const c1 = gradMag(resizeGray(cand, W1, H1));
  const identity = cost(b1, c1, 1, 0, 0, 1);
  let best = { s: 1, dx: 0, dy: 0, c: identity };
  const RX = Math.round(W1 * 0.05);
  const RY = Math.round(H1 * 0.05);
  for (let s = 0.94; s <= 1.0601; s += 0.01)
    for (let dy = -RY; dy <= RY; dy++)
      for (let dx = -RX; dx <= RX; dx++) {
        const c = cost(b1, c1, s, dx, dy, 2);
        if (c < best.c) best = { s, dx, dy, c };
      }
  // 細調（2 倍解析度）
  const W2 = W1 * 2;
  const H2 = H1 * 2;
  const b2 = gradMag(resizeGray(base, W2, H2));
  const c2 = gradMag(resizeGray(cand, W2, H2));
  let fine = { s: best.s, dx: best.dx * 2, dy: best.dy * 2, c: Infinity };
  for (let s = best.s - 0.006; s <= best.s + 0.0061; s += 0.003)
    for (let dy = fine.dy - 2; dy <= fine.dy + 2; dy++)
      for (let dx = fine.dx - 2; dx <= fine.dx + 2; dx++) {
        const c = cost(b2, c2, s, dx, dy, 1);
        if (c < fine.c) fine = { s, dx, dy, c };
      }
  // 第三層（4 倍）把誤差壓到約 2–3 px
  const W3 = W1 * 4;
  const H3 = H1 * 4;
  const b3 = gradMag(resizeGray(base, W3, H3));
  const c3 = gradMag(resizeGray(cand, W3, H3));
  let fine3 = { s: fine.s, dx: fine.dx * 2, dy: fine.dy * 2, c: Infinity };
  for (let s = fine.s - 0.002; s <= fine.s + 0.0021; s += 0.002)
    for (let dy = fine3.dy - 2; dy <= fine3.dy + 2; dy++)
      for (let dx = fine3.dx - 2; dx <= fine3.dx + 2; dx++) {
        const c = cost(b3, c3, s, dx, dy, 2);
        if (c < fine3.c) fine3 = { s, dx, dy, c };
      }
  const id3 = cost(b3, c3, 1, 0, 0, 2);
  const k = base.w / W3;
  return {
    dx: fine3.dx * k,
    dy: fine3.dy * k,
    scale: fine3.s,
    residual: id3 > 0 ? fine3.c / id3 : 1,
    similarity: similarity(b2, c2, fine3.s, (fine3.dx * W2) / W3, (fine3.dy * W2) / W3),
  };
}

/** 三次盒狀模糊近似高斯，用於羽化遮罩（O(1) / 像素） */
export function boxBlur3(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = src;
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    a = out;
  }
  return a;
}
