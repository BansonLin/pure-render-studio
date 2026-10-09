/**
 * 水波紋／迷宮紋疑似區偵測（純函式，不依賴 DOM，可在瀏覽器或 Node 執行）。
 *
 * 原理：
 * 1. 帶通濾波（DoG，σ1–σ2）抓出 3–12 px 週期的細紋理能量；
 * 2. 排除物件輪廓（低頻梯度強的像素），只看「面」上的紋理；
 * 3. 與 3D 原圖（或底圖）同位置比較：原本乾淨、現在多出明顯細紋 → 疑似生成紋；
 * 4. 結構張量一致性（coherence）高的條紋（水波）加權。
 *
 * 限制：這是「異常篩查」，不是零瑕疵證明。設計上刻意新增的材質（例如窗簾褶）
 * 也可能被標出，需人工判定；沒標出也不代表一定乾淨。
 */

export interface LumImage {
  w: number;
  h: number;
  lum: Float32Array; // 0..1
}

export interface RippleOptions {
  sigmaFine?: number;
  sigmaCoarse?: number;
  edgeSigma?: number;
  edgeThreshold?: number;
  tilesAcross?: number;
  /** 帶通能量絕對門檻（低於此值視為乾淨） */
  energyFloor?: number;
  /** 相對原圖的能量倍數門檻 */
  ratioThreshold?: number;
}

export interface RippleTile {
  energy: number;
  refEnergy: number | null;
  coherence: number;
  valid: boolean;
  score: number;
}

export interface RippleResult {
  cols: number;
  rows: number;
  tiles: RippleTile[];
  scores: number[];
  suspectRatio: number;
  cornerMax: number;
  findings: { x: number; y: number; w: number; h: number; score: number; where: string }[];
}

const DEFAULTS: Required<RippleOptions> = {
  sigmaFine: 0.8,
  sigmaCoarse: 2.6,
  edgeSigma: 2.0,
  edgeThreshold: 0.035,
  tilesAcross: 48,
  energyFloor: 0.000045,
  ratioThreshold: 2.2,
};

function gaussKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    s += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const k = gaussKernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        let xx = x + i;
        if (xx < 0) xx = -xx;
        else if (xx >= w) xx = 2 * w - xx - 2;
        acc += src[row + xx] * k[i + r];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        let yy = y + i;
        if (yy < 0) yy = -yy;
        else if (yy >= h) yy = 2 * h - yy - 2;
        acc += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** 物件輪廓遮罩（1 = 輪廓附近，不計入紋理） */
function edgeMask(lum: Float32Array, w: number, h: number, sigma: number, thr: number): Uint8Array {
  const g = gaussianBlur(lum, w, h, sigma);
  const m = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i + 1] - g[i - 1];
      const gy = g[i + w] - g[i - w];
      if (Math.sqrt(gx * gx + gy * gy) > thr) m[i] = 1;
    }
  }
  // 膨脹 3 px，避免輪廓光暈被當成紋理
  const out = new Uint8Array(w * h);
  const R = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

function bandPass(lum: Float32Array, w: number, h: number, s1: number, s2: number) {
  const a = gaussianBlur(lum, w, h, s1);
  const b = gaussianBlur(lum, w, h, s2);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = a[i] - b[i];
  return out;
}

interface TileStats {
  energy: number;
  coherence: number;
  valid: boolean;
}

function tileStats(
  band: Float32Array,
  edges: Uint8Array,
  w: number,
  h: number,
  cols: number,
  rows: number,
): TileStats[] {
  const out: TileStats[] = [];
  for (let ty = 0; ty < rows; ty++) {
    const y0 = Math.floor((ty * h) / rows);
    const y1 = Math.floor(((ty + 1) * h) / rows);
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.floor((tx * w) / cols);
      const x1 = Math.floor(((tx + 1) * w) / cols);
      let n = 0,
        e = 0,
        jxx = 0,
        jyy = 0,
        jxy = 0,
        total = 0;
      for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
        for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
          total++;
          const i = y * w + x;
          if (edges[i]) continue;
          const v = band[i];
          e += v * v;
          const gx = band[i + 1] - band[i - 1];
          const gy = band[i + w] - band[i - w];
          jxx += gx * gx;
          jyy += gy * gy;
          jxy += gx * gy;
          n++;
        }
      }
      const valid = total > 0 && n / total >= 0.35;
      const tr = jxx + jyy;
      const coh = tr > 1e-12 ? Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / tr : 0;
      out.push({ energy: n ? e / n : 0, coherence: coh, valid });
    }
  }
  return out;
}

function whereZh(cx: number, cy: number) {
  const h = cx < 0.33 ? "左" : cx > 0.67 ? "右" : "中";
  const v = cy < 0.33 ? "上" : cy > 0.67 ? "下" : "中";
  if (h === "中" && v === "中") return "畫面中央";
  return `畫面${v}${h}${(cx < 0.15 || cx > 0.85) && (cy < 0.15 || cy > 0.85) ? "角" : ""}`;
}

/**
 * @param cand 候選圖亮度
 * @param ref  比較基準（3D 原圖或底圖），須與 cand 同尺寸；無則只做絕對篩查
 */
export function detectRipples(cand: LumImage, ref: LumImage | null, opts: RippleOptions = {}): RippleResult {
  const o = { ...DEFAULTS, ...opts };
  const { w, h } = cand;
  if (ref && (ref.w !== w || ref.h !== h)) throw new Error("比較基準尺寸需與候選圖一致");
  const cols = o.tilesAcross;
  const rows = Math.max(1, Math.round((cols * h) / w));

  const cBand = bandPass(cand.lum, w, h, o.sigmaFine, o.sigmaCoarse);
  const cEdge = edgeMask(cand.lum, w, h, o.edgeSigma, o.edgeThreshold);
  const cStats = tileStats(cBand, cEdge, w, h, cols, rows);

  let rStats: TileStats[] | null = null;
  if (ref) {
    const rBand = bandPass(ref.lum, w, h, o.sigmaFine, o.sigmaCoarse);
    // 原圖用候選圖的輪廓遮罩：比的是同一批「面」像素
    rStats = tileStats(rBand, cEdge, w, h, cols, rows);
  }

  const tiles: RippleTile[] = cStats.map((c, i) => {
    const r = rStats ? rStats[i] : null;
    let score = 0;
    if (c.valid && c.energy > o.energyFloor) {
      // 絕對強度：floor → 0，floor×6 → 1
      const abs = Math.min(1, Math.log(c.energy / o.energyFloor) / Math.log(6));
      let rel = 1;
      if (r) {
        const ratio = (c.energy + o.energyFloor * 0.25) / (r.energy + o.energyFloor * 0.25);
        rel = ratio <= o.ratioThreshold ? 0 : Math.min(1, Math.log(ratio / o.ratioThreshold) / Math.log(4) + 0.35);
      }
      const cohBoost = 0.75 + 0.25 * Math.min(1, c.coherence / 0.5);
      score = Math.min(1, abs * rel * cohBoost);
    }
    return { energy: c.energy, refEnergy: r ? r.energy : null, coherence: c.coherence, valid: c.valid, score };
  });

  const scores = tiles.map((t) => t.score);
  const validCount = tiles.filter((t) => t.valid).length || 1;
  const SUSPECT = 0.5;
  const suspectRatio = tiles.filter((t) => t.score >= SUSPECT).length / validCount;

  let cornerMax = 0;
  const cz = 0.15;
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++) {
      const cx = (tx + 0.5) / cols;
      const cy = (ty + 0.5) / rows;
      if ((cx < cz || cx > 1 - cz) && (cy < cz || cy > 1 - cz)) {
        cornerMax = Math.max(cornerMax, scores[ty * cols + tx]);
      }
    }

  // 相鄰疑似格合併成區域
  const seen = new Uint8Array(cols * rows);
  const findings: RippleResult["findings"] = [];
  for (let i = 0; i < scores.length; i++) {
    if (seen[i] || scores[i] < SUSPECT) continue;
    const stack = [i];
    seen[i] = 1;
    let minX = cols,
      minY = rows,
      maxX = 0,
      maxY = 0,
      peak = 0,
      count = 0;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % cols;
      const y = (j - x) / cols;
      count++;
      peak = Math.max(peak, scores[j]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const k = ny * cols + nx;
        if (!seen[k] && scores[k] >= SUSPECT * 0.8) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (count < 2 && peak < 0.8) continue; // 單格弱訊號略過
    const fx = minX / cols;
    const fy = minY / rows;
    const fw = (maxX + 1) / cols - fx;
    const fh = (maxY + 1) / rows - fy;
    findings.push({ x: fx, y: fy, w: fw, h: fh, score: peak, where: whereZh(fx + fw / 2, fy + fh / 2) });
  }
  findings.sort((a, b) => b.score * b.w * b.h - a.score * a.w * a.h);

  return { cols, rows, tiles, scores, suspectRatio, cornerMax, findings: findings.slice(0, 12) };
}
