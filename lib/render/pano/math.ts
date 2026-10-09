/**
 * 360 環景縫合數學（純函式，不依賴 DOM）。
 *
 * 前提（物理限制，非程式限制）：
 * 所有來源圖必須是「同一相機位置」依序旋轉拍出（例如水平每 90° 一張）。
 * 從房間不同位置拍的四個角度（如 20 / 29 / 33 / 34）無法縫成真實環景——
 * 視差會讓接縫處的牆線、家具錯位。縫合後的接縫報告會把這種錯位標出。
 *
 * 座標約定：
 *  - 世界：+z 前、+x 右、+y 上。
 *  - 等距長方投影：x 0..W 對應經度 -180°..180°（中央 = 前方 yaw 0），
 *    y 0..H 對應緯度 +90°..-90°。
 *  - yaw 正值 = 向右轉；pitch 正值 = 抬頭；roll 為上下面的旋轉校正。
 */

export interface RGBAImage {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export interface PanoInput {
  img: RGBAImage;
  yaw: number;
  pitch: number;
  roll: number;
  /** 水平視角（度） */
  hfov: number;
}

type Vec3 = [number, number, number];

interface Cam {
  f: Vec3;
  r: Vec3;
  u: Vec3;
  tx: number; // tan(hfov/2)
  ty: number; // tan(vfov/2)
}

const D2R = Math.PI / 180;

export function camera(inp: Pick<PanoInput, "yaw" | "pitch" | "roll" | "hfov">, w: number, h: number): Cam {
  const yw = inp.yaw * D2R;
  const pt = inp.pitch * D2R;
  const rl = inp.roll * D2R;
  const f: Vec3 = [Math.cos(pt) * Math.sin(yw), Math.sin(pt), Math.cos(pt) * Math.cos(yw)];
  const r0: Vec3 = [Math.cos(yw), 0, -Math.sin(yw)];
  const u0: Vec3 = [-Math.sin(pt) * Math.sin(yw), Math.cos(pt), -Math.sin(pt) * Math.cos(yw)];
  const c = Math.cos(rl);
  const s = Math.sin(rl);
  const r: Vec3 = [r0[0] * c + u0[0] * s, r0[1] * c + u0[1] * s, r0[2] * c + u0[2] * s];
  const u: Vec3 = [u0[0] * c - r0[0] * s, u0[1] * c - r0[1] * s, u0[2] * c - r0[2] * s];
  const tx = Math.tan((inp.hfov * D2R) / 2);
  return { f, r, u, tx, ty: (tx * h) / w };
}

/** 方向 → 影像正規化座標（-1..1），不在前方回傳 null */
function project(cam: Cam, d: Vec3): [number, number] | null {
  const z = d[0] * cam.f[0] + d[1] * cam.f[1] + d[2] * cam.f[2];
  if (z <= 1e-6) return null;
  const x = (d[0] * cam.r[0] + d[1] * cam.r[1] + d[2] * cam.r[2]) / z / cam.tx;
  const y = (d[0] * cam.u[0] + d[1] * cam.u[1] + d[2] * cam.u[2]) / z / cam.ty;
  return [x, y];
}

function unproject(cam: Cam, x: number, y: number): Vec3 {
  const px = x * cam.tx;
  const py = y * cam.ty;
  const d: Vec3 = [
    cam.f[0] + px * cam.r[0] + py * cam.u[0],
    cam.f[1] + px * cam.r[1] + py * cam.u[1],
    cam.f[2] + px * cam.r[2] + py * cam.u[2],
  ];
  const n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
}

function dirFromLonLat(lon: number, lat: number): Vec3 {
  const cl = Math.cos(lat);
  return [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)];
}

function bilinear(img: RGBAImage, fx: number, fy: number, out: Float32Array, wrapX = false) {
  const { w, h, data } = img;
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  if (wrapX) {
    x0 = ((x0 % w) + w) % w;
    x1 = ((x1 % w) + w) % w;
  } else {
    x0 = Math.min(w - 1, Math.max(0, x0));
    x1 = Math.min(w - 1, Math.max(0, x1));
  }
  y0 = Math.min(h - 1, Math.max(0, y0));
  y1 = Math.min(h - 1, Math.max(0, y1));
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c] * (1 - ax) + data[i10 + c] * ax;
    const bot = data[i01 + c] * (1 - ax) + data[i11 + c] * ax;
    out[c] = top * (1 - ay) + bot * ay;
  }
}

function sampleInput(img: RGBAImage, x: number, y: number, out: Float32Array) {
  bilinear(img, ((x + 1) / 2) * img.w - 0.5, ((1 - y) / 2) * img.h - 0.5, out);
}

export interface SeamReport {
  a: number;
  b: number;
  samples: number;
  /** 有重疊才能可靠比對幾何；無重疊只能比色彩與邊界剖面 */
  overlap: boolean;
  /** 校色後平均色差（0..1） */
  colorDiff: number;
  /** 接縫兩側亮度剖面相關係數（-1..1，越高越連續） */
  structure: number;
  ok: boolean;
}

interface PairAcc {
  a: number;
  b: number;
  sa: [number, number, number];
  sb: [number, number, number];
  la: number[];
  lb: number[];
  n: number;
  /** true = 同方向重疊取樣；false = 邊界內外緊鄰取樣 */
  overlap: boolean;
}

/**
 * 沿每張圖邊界走一圈，找出接縫兩側成對樣本。
 * - 有重疊：同一方向在兩張圖各取樣（直接比對，最可靠）。
 * - 無重疊（例如剛好 90° 四張）：取邊界內外緊鄰的兩點比對。
 */
function collectSeamPairs(inputs: PanoInput[], cams: Cam[]): PairAcc[] {
  const pairs = new Map<string, PairAcc>();
  const ca = new Float32Array(3);
  const cb = new Float32Array(3);
  const STEPS = 200;
  const IN = 0.99;
  const OUT = 1.012;
  inputs.forEach((inp, i) => {
    const pts: [number, number, number, number][] = [];
    for (let k = 0; k <= STEPS; k++) {
      const t = -IN + (2 * IN * k) / STEPS;
      pts.push([IN, t, OUT, t], [-IN, t, -OUT, t], [t, IN, t, OUT], [t, -IN, t, -OUT]);
    }
    for (const [xi, yi, xo, yo] of pts) {
      const dIn = unproject(cams[i], xi, yi);
      const dOut = unproject(cams[i], xo, yo);
      let best = -1;
      let bestEdge = Infinity;
      let bx = 0,
        by = 0;
      let overlap = false;
      // 先找重疊（同方向），再找緊鄰
      for (const d of [dIn, dOut]) {
        overlap = d === dIn;
        for (let j = 0; j < inputs.length; j++) {
          if (j === i) continue;
          const p = project(cams[j], d);
          if (!p) continue;
          const edge = Math.max(Math.abs(p[0]), Math.abs(p[1]));
          if (edge > (d === dIn ? 0.97 : 1)) continue;
          if (edge < bestEdge) {
            bestEdge = edge;
            best = j;
            bx = p[0];
            by = p[1];
          }
        }
        if (best >= 0) break;
      }
      if (best < 0) continue;
      const a = Math.min(i, best);
      const b = Math.max(i, best);
      const key = `${a}-${b}-${overlap ? "o" : "n"}`;
      let acc = pairs.get(key);
      if (!acc) {
        acc = { a, b, sa: [0, 0, 0], sb: [0, 0, 0], la: [], lb: [], n: 0, overlap };
        pairs.set(key, acc);
      }
      sampleInput(inp.img, xi, yi, ca);
      sampleInput(inputs[best].img, bx, by, cb);
      const [pa, pb] = i === a ? [ca, cb] : [cb, ca];
      for (let c = 0; c < 3; c++) {
        acc.sa[c] += Math.log(pa[c] + 16);
        acc.sb[c] += Math.log(pb[c] + 16);
      }
      acc.la.push(0.2126 * pa[0] + 0.7152 * pa[1] + 0.0722 * pa[2]);
      acc.lb.push(0.2126 * pb[0] + 0.7152 * pb[1] + 0.0722 * pb[2]);
      acc.n++;
    }
  });
  // 同一對圖若有足夠重疊樣本，只用重疊樣本（緊鄰樣本有方向差，會偏移增益）
  const out: PairAcc[] = [];
  for (const p of Array.from(pairs.values())) {
    if (p.n < 8) continue;
    if (!p.overlap) {
      const o = pairs.get(`${p.a}-${p.b}-o`);
      if (o && o.n >= 8) continue;
    }
    out.push(p);
  }
  return out;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

/** 以接縫兩側色彩求各圖增益（對數最小平方，整體平均增益 = 1） */
export function solveGains(inputs: PanoInput[], pairs: PairAcc[]): number[][] {
  const n = inputs.length;
  const gains: number[][] = Array.from({ length: n }, () => [1, 1, 1]);
  if (!pairs.length) return gains;
  const LAMBDA = 0.05;
  for (let c = 0; c < 3; c++) {
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const rhs = new Array(n).fill(0);
    for (const p of pairs) {
      const d = p.sb[c] / p.n - p.sa[c] / p.n; // 希望 la + ga = lb + gb
      const w = Math.min(1, p.n / 60);
      A[p.a][p.a] += w;
      A[p.b][p.b] += w;
      A[p.a][p.b] -= w;
      A[p.b][p.a] -= w;
      rhs[p.a] += w * d;
      rhs[p.b] -= w * d;
    }
    for (let i = 0; i < n; i++) A[i][i] += LAMBDA;
    const g = solve(A, rhs);
    const mean = g.reduce((s, v) => s + v, 0) / n;
    // 限制校色幅度：差異過大通常是幾何錯位，不是曝光差，交給接縫報告示警
    for (let i = 0; i < n; i++) gains[i][c] = Math.min(1.35, Math.max(0.74, Math.exp(g[i] - mean)));
  }
  return gains;
}

function smoothProfile(a: number[], r = 3): number[] {
  return a.map((_, i) => {
    let s = 0,
      n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) {
      s += a[k];
      n++;
    }
    return s / n;
  });
}

function corr(a0: number[], b0: number[]) {
  const a = smoothProfile(a0);
  const b = smoothProfile(b0);
  const n = a.length;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa < 1e-6 || sbb < 1e-6) return 1; // 兩側都是平面（純白牆）→ 視為連續
  return sab / Math.sqrt(saa * sbb);
}

export interface StitchOptions {
  outW: number;
  harmonize: boolean;
  /** 羽化寬度（正規化座標比例，0.02–0.2） */
  feather: number;
  fillHoles: boolean;
  yieldEvery?: number;
  onYield?: (progress: number) => Promise<void>;
}

export interface StitchResult {
  img: RGBAImage;
  /** 0 = 無來源、1 = 真實來源、2 = 補色 */
  coverage: Uint8Array;
  coveredRatio: number;
  gains: number[][];
  seams: SeamReport[];
}

function smooth(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export async function stitchEquirect(inputs: PanoInput[], opts: StitchOptions): Promise<StitchResult> {
  const W = Math.round(opts.outW);
  const H = Math.round(W / 2);
  const cams = inputs.map((i) => camera(i, i.img.w, i.img.h));
  const pairs = collectSeamPairs(inputs, cams);
  const gains = opts.harmonize ? solveGains(inputs, pairs) : inputs.map(() => [1, 1, 1]);

  const seams: SeamReport[] = pairs.map((p) => {
    let diff = 0;
    for (let c = 0; c < 3; c++) {
      const a = (Math.exp(p.sa[c] / p.n) - 16) * gains[p.a][c];
      const b = (Math.exp(p.sb[c] / p.n) - 16) * gains[p.b][c];
      diff += Math.abs(a - b) / 255 / 3;
    }
    const structure = corr(p.la, p.lb);
    return {
      a: p.a,
      b: p.b,
      samples: p.n,
      colorDiff: diff,
      structure,
      overlap: p.overlap,
      ok: diff < 0.05 && structure > 0.6,
    };
  });

  const out = new Uint8ClampedArray(W * H * 4);
  const cov = new Uint8Array(W * H);
  const s = new Float32Array(3);
  const acc = new Float32Array(3);
  const feather = Math.max(0.005, opts.feather);
  const yieldEvery = opts.yieldEvery ?? 64;

  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      const d = dirFromLonLat(lon, lat);
      acc[0] = acc[1] = acc[2] = 0;
      let wsum = 0;
      for (let k = 0; k < inputs.length; k++) {
        const p = project(cams[k], d);
        if (!p) continue;
        const ax = Math.abs(p[0]);
        const ay = Math.abs(p[1]);
        if (ax > 1 || ay > 1) continue;
        const wgt = 1e-3 + smooth((1 - ax) / feather) * smooth((1 - ay) / feather);
        sampleInput(inputs[k].img, p[0], p[1], s);
        acc[0] += s[0] * gains[k][0] * wgt;
        acc[1] += s[1] * gains[k][1] * wgt;
        acc[2] += s[2] * gains[k][2] * wgt;
        wsum += wgt;
      }
      const o = (y * W + x) * 4;
      if (wsum > 0) {
        out[o] = acc[0] / wsum;
        out[o + 1] = acc[1] / wsum;
        out[o + 2] = acc[2] / wsum;
        cov[y * W + x] = 1;
      }
      out[o + 3] = 255;
    }
    if (opts.onYield && y % yieldEvery === 0) await opts.onYield(y / H);
  }

  if (opts.fillHoles) fillPoles(out, cov, W, H);
  let covered = 0;
  for (let i = 0; i < cov.length; i++) if (cov[i] === 1) covered++;
  return { img: { w: W, h: H, data: out }, coverage: cov, coveredRatio: covered / cov.length, gains, seams };
}

/**
 * 天花／地板缺口補色：由每欄最近的真實像素往極點漸變到平均色，
 * 越靠近極點水平模糊越寬，避免放射狀拉絲。補色區會在介面上標示為「非真實渲染」。
 */
export function fillPoles(out: Uint8ClampedArray, cov: Uint8Array, W: number, H: number) {
  for (const top of [true, false]) {
    const edge = new Int32Array(W).fill(-1);
    const cols = new Float32Array(W * 3);
    const pole = [0, 0, 0];
    let pn = 0;
    for (let x = 0; x < W; x++) {
      if (top) {
        for (let y = 0; y < H; y++)
          if (cov[y * W + x] === 1) {
            edge[x] = y;
            break;
          }
      } else {
        for (let y = H - 1; y >= 0; y--)
          if (cov[y * W + x] === 1) {
            edge[x] = y;
            break;
          }
      }
      if (edge[x] < 0) continue;
      // 取邊緣內側 6 列平均，避免邊緣雜訊
      const acc = [0, 0, 0];
      let n = 0;
      for (let k = 0; k < 6; k++) {
        const yy = top ? edge[x] + k : edge[x] - k;
        if (yy < 0 || yy >= H || cov[yy * W + x] !== 1) continue;
        const o = (yy * W + x) * 4;
        acc[0] += out[o];
        acc[1] += out[o + 1];
        acc[2] += out[o + 2];
        n++;
      }
      for (let c = 0; c < 3; c++) {
        cols[x * 3 + c] = acc[c] / Math.max(1, n);
        pole[c] += cols[x * 3 + c];
      }
      pn++;
    }
    if (!pn) continue;
    for (let c = 0; c < 3; c++) pole[c] /= pn;
    // 沒有任何覆蓋的欄位用極點色
    for (let x = 0; x < W; x++)
      if (edge[x] < 0) for (let c = 0; c < 3; c++) cols[x * 3 + c] = pole[c];
    // 環狀前綴和，O(1) 取區間平均
    const pre = new Float64Array((W * 2 + 1) * 3);
    for (let i = 0; i < W * 2; i++)
      for (let c = 0; c < 3; c++) pre[(i + 1) * 3 + c] = pre[i * 3 + c] + cols[(i % W) * 3 + c];
    for (let x = 0; x < W; x++) {
      const e = edge[x] < 0 ? (top ? H / 2 : H / 2) : edge[x];
      const span = top ? e : H - 1 - e;
      if (span <= 0) continue;
      for (let k = 0; k < span; k++) {
        const y = top ? k : H - 1 - k;
        if (cov[y * W + x] === 1) continue;
        const t = 1 - k / span; // 1 = 極點
        const R = Math.max(1, Math.floor(t * W * 0.12));
        const a = x - R + W;
        const b = x + R + W;
        const n = b - a + 1;
        const o = (y * W + x) * 4;
        const mix = smooth(t);
        for (let c = 0; c < 3; c++) {
          const avg = (pre[(b + 1) * 3 + c] - pre[a * 3 + c]) / n;
          out[o + c] = avg * (1 - mix) + pole[c] * mix;
        }
        cov[y * W + x] = 2;
      }
    }
  }
}

/** 從全景切出透視圖（供「切成立方面 → AI 逐面優化 → 再縫回」流程與自測） */
export function renderPerspective(
  equi: RGBAImage,
  view: Pick<PanoInput, "yaw" | "pitch" | "roll" | "hfov">,
  w: number,
  h: number,
): RGBAImage {
  const cam = camera(view, w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  const s = new Float32Array(3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const ny = 1 - ((y + 0.5) / h) * 2;
      const d = unproject(cam, nx, ny);
      const lon = Math.atan2(d[0], d[2]);
      const lat = Math.asin(Math.max(-1, Math.min(1, d[1])));
      const fx = (lon / (2 * Math.PI) + 0.5) * equi.w - 0.5;
      const fy = (0.5 - lat / Math.PI) * equi.h - 0.5;
      bilinear(equi, fx, fy, s, true);
      const o = (y * w + x) * 4;
      out[o] = s[0];
      out[o + 1] = s[1];
      out[o + 2] = s[2];
      out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

/** 預設面配置 */
export function presetFaces(mode: "ring4" | "cube6" | "ringN", n = 4) {
  if (mode === "cube6") {
    return [
      { label: "前 0°", yaw: 0, pitch: 0, roll: 0 },
      { label: "右 90°", yaw: 90, pitch: 0, roll: 0 },
      { label: "後 180°", yaw: 180, pitch: 0, roll: 0 },
      { label: "左 270°", yaw: 270, pitch: 0, roll: 0 },
      { label: "上（天花）", yaw: 0, pitch: 90, roll: 0 },
      { label: "下（地板）", yaw: 0, pitch: -90, roll: 0 },
    ];
  }
  const count = mode === "ring4" ? 4 : Math.max(3, Math.min(12, n));
  const names = ["前", "右", "後", "左"];
  return Array.from({ length: count }, (_, i) => {
    const yaw = Math.round((360 / count) * i);
    return {
      label: count === 4 ? `${names[i]} ${yaw}°` : `第 ${i + 1} 張 ${yaw}°`,
      yaw,
      pitch: 0,
      roll: 0,
    };
  });
}

/** 檢查環景配置是否能完整覆蓋水平 360° */
export function ringCoverageIssue(hfov: number, ringCount: number): string | null {
  if (ringCount === 0) return null;
  const need = 360 / ringCount;
  if (hfov + 0.01 < need)
    return `水平視角 ${hfov}° 小於每張間隔 ${need.toFixed(1)}°，接縫處會出現空隙。請把視角設為 ≥ ${need.toFixed(0)}°，或增加張數。`;
  return null;
}
