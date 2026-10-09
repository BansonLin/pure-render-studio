"use client";

import { estimateAlignment, boxBlur3, type Alignment } from "./qa/align";
import { detectRipples } from "./qa/ripple";
import {
  canvasToBlob,
  ctx2d,
  decodeImage,
  luminance,
  makeCanvas,
  rasterize,
} from "./image";
import { describeArea, shapeBounds } from "./compiler";
import type { Region, RippleReport } from "./types";

/**
 * 匯入 AI 結果 → 候選版本的影像處理管線：
 *   1. 回復底圖原始尺寸（AI 常輸出較小尺寸，例如 2048→1672）
 *   2. 鏡位校正：估計縮放＋平移，把結果對回底圖構圖
 *   3. 選區回貼：選區外像素還原為底圖（防止非修改區劣化、水波紋累積）
 */

export interface BuildOptions {
  regions: Region[];
  align: boolean;
  composite: boolean;
  /** 羽化寬度（底圖寬度比例） */
  feather: number;
}

export interface BuildResult {
  blob: Blob;
  alignment: Alignment | null;
  composited: boolean;
  notes: string[];
}

const WORK_W = 1024;

/** 把選區畫成 0..1 遮罩（1 = 要修改） */
export function rasterizeRegions(
  regions: Region[],
  w: number,
  h: number,
  kinds: Region["kind"][] = ["edit", "object"],
): Float32Array {
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const r of regions) {
    if (!kinds.includes(r.kind)) continue;
    const s = r.shape;
    if (s.type === "rect") {
      ctx.fillRect(s.x * w, s.y * h, s.w * w, s.h * h);
    } else {
      ctx.lineWidth = s.radius * 2 * w;
      for (const stroke of s.strokes) {
        if (!stroke.length) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * w, stroke[0].y * h);
        for (const p of stroke.slice(1)) ctx.lineTo(p.x * w, p.y * h);
        if (stroke.length === 1) ctx.lineTo(stroke[0].x * w + 0.1, stroke[0].y * h);
        ctx.stroke();
      }
    }
  }
  // 鎖定區永遠扣除
  ctx.fillStyle = "#000";
  for (const r of regions) {
    if (r.kind !== "lock" || r.shape.type !== "rect") continue;
    const s = r.shape;
    ctx.fillRect(s.x * w, s.y * h, s.w * w, s.h * h);
  }
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

/** OpenAI 等供應商用的遮罩 PNG：透明 = 可編輯 */
export async function maskPng(regions: Region[], w: number, h: number): Promise<Blob> {
  const m = rasterizeRegions(regions, w, h);
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < m.length; i++) {
    img.data[i * 4] = 0;
    img.data[i * 4 + 1] = 0;
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = m[i] > 0.5 ? 0 : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvasToBlob(c);
}

/** 標註示意圖：底圖 + 編號框（ChatGPT 手動模式輔助理解；提示詞已註明不得畫出） */
export async function annotationGuide(base: Blob, regions: Region[]): Promise<Blob> {
  const bmp = await decodeImage(base);
  const w = Math.min(1600, bmp.width);
  const h = Math.round((w * bmp.height) / bmp.width);
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const colors: Record<Region["kind"], string> = { edit: "#e11d48", lock: "#2563eb", object: "#d97706" };
  const counters = { edit: 0, lock: 0, object: 0 };
  for (const r of regions) {
    counters[r.kind]++;
    const b = shapeBounds(r.shape, w / h);
    const tag = `${r.kind === "edit" ? "E" : r.kind === "lock" ? "L" : "O"}${counters[r.kind]}`;
    ctx.strokeStyle = colors[r.kind];
    ctx.lineWidth = Math.max(3, w / 400);
    ctx.setLineDash(r.kind === "lock" ? [10, 6] : []);
    ctx.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
    ctx.setLineDash([]);
    const fs = Math.max(16, w / 60);
    ctx.font = `600 ${fs}px sans-serif`;
    const tw = ctx.measureText(tag).width + fs * 0.6;
    ctx.fillStyle = colors[r.kind];
    ctx.fillRect(b.x * w, b.y * h, tw, fs * 1.4);
    ctx.fillStyle = "#fff";
    ctx.fillText(tag, b.x * w + fs * 0.3, b.y * h + fs * 1.05);
  }
  return canvasToBlob(c, "image/jpeg", 0.9);
}

function grayOf(bmp: CanvasImageSource, w: number, h: number) {
  return { w, h, px: luminance(rasterize(bmp, w, h)) };
}

export async function buildCandidate(
  baseBlob: Blob,
  resultBlob: Blob,
  opts: BuildOptions,
): Promise<BuildResult> {
  const base = await decodeImage(baseBlob);
  const res = await decodeImage(resultBlob);
  const W = base.width;
  const H = base.height;
  const notes: string[] = [];
  const arBase = W / H;
  const arRes = res.width / res.height;
  if (Math.abs(arRes / arBase - 1) > 0.03) {
    notes.push(
      `AI 輸出比例 ${res.width}×${res.height} 與底圖 ${W}×${H} 不同（差 ${Math.round(Math.abs(arRes / arBase - 1) * 100)}%），已拉伸對齊；請留意變形。`,
    );
  }
  if (res.width < W) {
    notes.push(`AI 輸出 ${res.width}px 寬，已放大回底圖 ${W}px（選區內為重採樣，非原生細節）。`);
  }

  // 1) 拉伸到底圖尺寸
  const stretched = makeCanvas(W, H);
  const sctx = ctx2d(stretched);
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(res, 0, 0, W, H);
  res.close();

  // 2) 鏡位校正
  let alignment: Alignment | null = null;
  const out = makeCanvas(W, H);
  const octx = ctx2d(out);
  octx.imageSmoothingQuality = "high";
  octx.drawImage(base, 0, 0);
  if (opts.align) {
    const ww = Math.min(WORK_W, W);
    const wh = Math.round((ww * H) / W);
    const a = estimateAlignment(grayOf(base, ww, wh), grayOf(stretched, ww, wh));
    const k = W / ww;
    alignment = { ...a, dx: a.dx * k, dy: a.dy * k };
    const shift = Math.hypot(alignment.dx / W, alignment.dy / H);
    if (Math.abs(alignment.scale - 1) > 0.008 || shift > 0.004) {
      notes.push(
        `偵測到 AI 改變構圖：縮放 ${((1 / alignment.scale - 1) * 100).toFixed(1)}%、位移 ${Math.round(alignment.dx)}, ${Math.round(alignment.dy)} px，已校正回原鏡位。`,
      );
      if (alignment.scale < 0.995) notes.push("校正後畫面邊緣缺少的細條以底圖補齊，請檢查邊緣。");
    }
    const cx = W / 2;
    const cy = H / 2;
    octx.setTransform(alignment.scale, 0, 0, alignment.scale, cx + alignment.dx - alignment.scale * cx, cy + alignment.dy - alignment.scale * cy);
    octx.drawImage(stretched, 0, 0);
    octx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    octx.drawImage(stretched, 0, 0);
  }

  // 3) 選區回貼
  const hasEdit = opts.regions.some((r) => r.kind !== "lock");
  const hasLock = opts.regions.some((r) => r.kind === "lock");
  let composited = false;
  if (opts.composite && (hasEdit || hasLock)) {
    const mask = hasEdit
      ? rasterizeRegions(opts.regions, W, H)
      : (() => {
          // 只有鎖定區：鎖定區外全部採用 AI 結果
          const m = rasterizeRegions(opts.regions, W, H, ["lock"]);
          for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
          return m;
        })();
    const r = Math.max(2, Math.round(W * opts.feather));
    const soft = boxBlur3(mask, W, H, Math.round(r / 2));
    const baseData = rasterize(base, W, H).data;
    const img = octx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0, p = 0; p < soft.length; i += 4, p++) {
      const m = soft[p];
      d[i] = baseData[i] * (1 - m) + d[i] * m;
      d[i + 1] = baseData[i + 1] * (1 - m) + d[i + 1] * m;
      d[i + 2] = baseData[i + 2] * (1 - m) + d[i + 2] * m;
    }
    octx.putImageData(img, 0, 0);
    composited = true;
    notes.push("選區外像素已還原為底圖（羽化接縫）。");
  }
  base.close();
  return { blob: await canvasToBlob(out), alignment, composited, notes };
}

/** 對候選圖跑水波紋篩查（瀏覽器端） */
export async function runRippleQa(
  candidate: Blob,
  reference: Blob | null,
  comparedTo: RippleReport["comparedTo"],
): Promise<RippleReport> {
  const c = await decodeImage(candidate);
  const w = Math.min(1680, c.width);
  const h = Math.round((w * c.height) / c.width);
  const cand = { w, h, lum: luminance(rasterize(c, w, h)) };
  c.close();
  let ref = null;
  if (reference) {
    const r = await decodeImage(reference);
    ref = { w, h, lum: luminance(rasterize(r, w, h)) };
    r.close();
  }
  const res = detectRipples(cand, ref);
  return {
    comparedTo: ref ? comparedTo : "none",
    suspectRatio: res.suspectRatio,
    cornerMax: res.cornerMax,
    findings: res.findings,
    grid: { cols: res.cols, rows: res.rows, scores: res.scores },
    analyzedAt: new Date().toISOString(),
  };
}

export function findingText(f: { x: number; y: number; w: number; h: number; score: number }) {
  return `${describeArea(f).zh}（強度 ${Math.round(f.score * 100)}）`;
}
