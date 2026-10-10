"use client";

import { assetBlob } from "@/store/render-store";
import { describeArea, shapeBounds } from "./compiler";
import { blobToBase64, canvasToBlob, ctx2d, decodeImage, makeCanvas } from "./image";
import type { AiReview, RenderProject, Version } from "./types";

/**
 * Claude 看圖驗收（瀏覽器端）：準備底圖、結果圖與說明，交給伺服器用後台金鑰呼叫 Claude。
 * 結果只是建議：判定、核准仍由人按。
 */

/** 每百萬 token 美元（2026-10 官方價目，示意用） */
export const CLAUDE_PRICE: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

async function toJpegB64(b: Blob, maxEdge: number) {
  const bmp = await decodeImage(b);
  const s = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return blobToBase64(await canvasToBlob(c, "image/jpeg", 0.88));
}

function briefFor(p: RenderProject, v: Version): string {
  const view = p.views.find((x) => x.id === v.viewId);
  const lines: string[] = [];
  lines.push(`View: ${view?.id ?? ""} ${view?.name ?? ""}${view?.room ? ` (${view.room})` : ""}.`);
  if (v.rawRequest.trim()) lines.push(`Designer's request (original words): ${v.rawRequest.trim()}`);
  const regions = v.regions.map((r, i) => {
    const b = shapeBounds(r.shape);
    const where = describeArea(b).en;
    const box = `x ${Math.round(b.x * 100)}–${Math.round((b.x + b.w) * 100)}%, y ${Math.round(b.y * 100)}–${Math.round((b.y + b.h) * 100)}%`;
    const kind = r.kind === "edit" ? "EDIT" : r.kind === "lock" ? "LOCKED (must not change)" : "OBJECT position";
    return `- ${kind} region ${i + 1}, ${where} (${box})${r.label ? ` "${r.label}"` : ""}${r.instruction ? `: ${r.instruction}` : ""}`;
  });
  lines.push(regions.length ? `Regions:\n${regions.join("\n")}` : "No regions: this was a whole-image edit.");
  const objs = p.sceneObjects.filter((o) => view && o.views[view.id] && o.views[view.id] !== "hidden");
  if (objs.length) {
    lines.push(
      `Scene objects expected in this view:\n${objs.map((o) => `- ${o.name}${o.count !== null ? ` ×${o.count} in the whole scene` : ""}${o.anchor ? `, at ${o.anchor}` : ""}`).join("\n")}`,
    );
  }
  lines.push(`Composited: ${v.composited ? "yes, pixels outside edit regions were restored from the BASE" : "no, the whole RESULT is AI output"}.`);
  return lines.join("\n\n");
}

export async function runClaudeReview(p: RenderProject, v: Version): Promise<AiReview> {
  if (!v.resultAssetId || !v.qa) throw new Error("這個版本還沒有 AI 結果可以檢查。");
  const [baseBlob, resultBlob] = await Promise.all([assetBlob(v.baseAssetId), assetBlob(v.resultAssetId)]);
  if (!baseBlob || !resultBlob) throw new Error("找不到底圖或結果圖檔案。");
  // 2048 是渲染圖原寬；兩張加起來仍在伺服器 4 MB 請求上限內
  const [baseB64, resultB64] = await Promise.all([toJpegB64(baseBlob, 2048), toJpegB64(resultBlob, 2048)]);
  let res: Response;
  try {
    res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseB64, resultB64, brief: briefFor(p, v), checklist: v.qa.checks.map((c) => ({ id: c.id, label: c.label })) }),
    });
  } catch {
    throw new Error("連不到伺服器，請檢查網路後再試。");
  }
  const j = (await res.json().catch(() => ({}))) as AiReview & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `檢查失敗（${res.status}）`);
  return j;
}

/** 依實際用量估算費用（美元）；未知模型回傳 null */
export function estimateCost(model: string, usage: AiReview["usage"]): number | null {
  const price = CLAUDE_PRICE[model];
  if (!price || !usage) return null;
  return (usage.input * price.input + usage.output * price.output) / 1_000_000;
}
