"use client";

import { canvasToBlob, ctx2d, decodeImage, makeCanvas, nextFrame, rasterize } from "../image";
import {
  renderPerspective,
  stitchEquirect,
  type PanoInput,
  type RGBAImage,
  type StitchResult,
} from "./math";

/** 單面最大寬度：超過就先縮，避免手機記憶體爆掉 */
const MAX_FACE_W = 2048;

export async function blobToRGBA(blob: Blob, maxW = MAX_FACE_W): Promise<RGBAImage> {
  const bmp = await decodeImage(blob);
  const w = Math.min(maxW, bmp.width);
  const h = Math.round((w * bmp.height) / bmp.width);
  const img = rasterize(bmp, w, h);
  bmp.close();
  return { w, h, data: img.data };
}

export function rgbaToCanvas(img: RGBAImage): HTMLCanvasElement {
  const c = makeCanvas(img.w, img.h);
  const id = new ImageData(new Uint8ClampedArray(img.data), img.w, img.h);
  ctx2d(c).putImageData(id, 0, 0);
  return c;
}

export interface FaceSpec {
  blob: Blob;
  yaw: number;
  pitch: number;
  roll: number;
  hfov: number;
}

export async function runStitch(
  faces: FaceSpec[],
  opts: { outW: number; harmonize: boolean; feather: number; fillHoles: boolean },
  onProgress: (p: number) => void,
): Promise<{ jpeg: Blob; coverage: Blob; result: StitchResult }> {
  const inputs: PanoInput[] = [];
  for (const f of faces) {
    inputs.push({ img: await blobToRGBA(f.blob), yaw: f.yaw, pitch: f.pitch, roll: f.roll, hfov: f.hfov });
    await nextFrame();
  }
  const result = await stitchEquirect(inputs, {
    ...opts,
    yieldEvery: 24,
    onYield: async (p) => {
      onProgress(p);
      await nextFrame();
    },
  });
  onProgress(1);
  const canvas = rgbaToCanvas(result.img);
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.92);

  // 覆蓋圖：綠 = 真實來源、橘 = 補色、紅 = 無資料
  const { w, h } = result.img;
  const cov = makeCanvas(w, h);
  const ctx = ctx2d(cov);
  const id = ctx.createImageData(w, h);
  for (let i = 0; i < result.coverage.length; i++) {
    const v = result.coverage[i];
    const o = i * 4;
    if (v === 1) continue;
    id.data[o] = v === 2 ? 245 : 225;
    id.data[o + 1] = v === 2 ? 158 : 29;
    id.data[o + 2] = v === 2 ? 11 : 72;
    id.data[o + 3] = 120;
  }
  ctx.putImageData(id, 0, 0);
  const coverage = await canvasToBlob(cov);
  return { jpeg, coverage, result };
}

/** 把等距長方全景切成立方面，供逐面 AI 優化後再縫回 */
export async function sliceToCube(
  equiBlob: Blob,
  faceSize: number,
  faces: { label: string; yaw: number; pitch: number; roll: number }[],
): Promise<{ label: string; blob: Blob }[]> {
  const bmp = await decodeImage(equiBlob);
  const w = Math.min(8192, bmp.width);
  const h = Math.round(w / 2);
  const img = rasterize(bmp, w, h);
  bmp.close();
  const equi: RGBAImage = { w, h, data: img.data };
  const out: { label: string; blob: Blob }[] = [];
  for (const f of faces) {
    const face = renderPerspective(equi, { ...f, hfov: 90 }, faceSize, faceSize);
    out.push({ label: f.label, blob: await canvasToBlob(rgbaToCanvas(face), "image/png") });
    await nextFrame();
  }
  return out;
}
