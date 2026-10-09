"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { assetBlob } from "@/store/render-store";
import { describeArea, shapeBounds } from "./compiler";
import { blobToBase64, canvasToBlob, ctx2d, decodeImage, makeCanvas } from "./image";
import type { ModelOption } from "./provider";
import { bumpUsage, readSettings } from "./settings";
import type { AiReview, RenderProject, Version } from "./types";

/**
 * Claude 看圖驗收：把底圖與 AI 結果一起給 Claude，逐項對照人工檢查清單給建議。
 *
 * 金鑰在本裝置設定，由瀏覽器直接呼叫 Anthropic（SDK 的 dangerouslyAllowBrowser 會帶上
 * 直連標頭），不經過璞石伺服器。結果只是建議：判定、核准仍由人按。
 */

const CLAUDE_HINTS: Record<string, { rank: number; note: string }> = {
  "claude-opus-5-5": { rank: 0, note: "建議：看圖最仔細" },
  "claude-sonnet-5-5": { rank: 1, note: "較快，約一半價格" },
  "claude-haiku-5-5": { rank: 2, note: "最便宜，只適合粗篩" },
  "claude-fable-5-1": { rank: 3, note: "最強，價格約 Opus 的 2.5 倍" },
};

/** 每百萬 token 美元（2026-10 官方價目，示意用） */
export const CLAUDE_PRICE: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

// 這幾個模型支援伺服器端 fallback：遇到安全分類誤擋時自動換模型重跑，不必使用者重送
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

async function client(key: string) {
  const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
  // 不自動重試：與出圖同一原則，花錢的請求失敗就停下來讓人決定
  return new AnthropicSdk({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 });
}

async function friendlyError(e: unknown): Promise<Error> {
  const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
  if (e instanceof AnthropicSdk.AuthenticationError) return new Error("Claude 金鑰無效或已被撤銷。");
  if (e instanceof AnthropicSdk.PermissionDeniedError) return new Error("這把 Claude 金鑰沒有使用此模型的權限。");
  if (e instanceof AnthropicSdk.NotFoundError) return new Error("找不到此 Claude 模型，請到「設定」重新選擇。");
  if (e instanceof AnthropicSdk.RateLimitError) return new Error("Claude 請求太頻繁或額度不足，請稍後再試。");
  if (e instanceof AnthropicSdk.BadRequestError) return new Error(`Claude 拒絕此請求：${e.message}`);
  if (e instanceof AnthropicSdk.APIConnectionError) return new Error("瀏覽器連不到 Anthropic（請檢查網路）。");
  if (e instanceof AnthropicSdk.APIError) return new Error(`Claude 回應錯誤（${e.status ?? "?"}）：${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

export async function listClaudeModels(key: string): Promise<ModelOption[]> {
  const c = await client(key);
  const found: { id: string; label: string; created: string }[] = [];
  try {
    for await (const m of c.models.list()) {
      const caps = (m as unknown as { capabilities?: { image_input?: { supported?: boolean } } }).capabilities;
      if (caps?.image_input && caps.image_input.supported === false) continue;
      found.push({ id: m.id, label: m.display_name || m.id, created: m.created_at });
    }
  } catch (e) {
    throw await friendlyError(e);
  }
  if (!found.length) throw new Error("這把金鑰看不到任何可看圖的 Claude 模型。");
  const rank = (id: string) => CLAUDE_HINTS[id]?.rank ?? 99;
  found.sort((a, b) => rank(a.id) - rank(b.id) || b.created.localeCompare(a.created));
  return found.map((m, i) => ({ id: m.id, label: m.label, note: CLAUDE_HINTS[m.id]?.note, recommended: i === 0 && rank(m.id) === 0 }));
}


// zod 與 SDK 都只在按下檢查時才載入，不拖慢一般頁面
async function reviewSchema() {
  const { z } = await import("zod");
  return z.object({
    summary: z.string(),
    instructions_followed: z.enum(["yes", "partial", "no", "unclear"]),
    checks: z.array(
      z.object({
        id: z.string(),
        verdict: z.enum(["pass", "fail", "uncertain"]),
        reason: z.string(),
      }),
    ),
    issues: z.array(
      z.object({
        location: z.enum(["左上", "上方", "右上", "左側", "中央", "右側", "左下", "下方", "右下", "全圖"]),
        problem: z.string(),
        severity: z.enum(["high", "medium", "low"]),
      }),
    ),
  });
}

const SYSTEM = `You are a senior visualization QA reviewer at a Taiwanese interior design firm.
You compare a 3D render (the BASE) with an AI-edited version of it (the RESULT) and judge whether the edit is safe to show a client.

What matters, in order:
1. Geometry and camera: the RESULT must keep the BASE camera, wall lines, doors, windows, ceiling and cabinetry divisions. Flag any door, window or opening whose meaning changed (for example an interior door that now looks like it leads outdoors), and any shifted or rescaled framing.
2. Objects: count and placement must match the BASE unless an edit region asked for a change. Flag added, removed, duplicated or moved furniture and decor.
3. Edit regions: each requested change should be done inside its region and nowhere else. Outside the edit regions the pixels were restored from the BASE, so large differences there are suspicious.
4. Surface artifacts: ripple, moiré, maze-like or wavy textures on fabric, rugs, curtains, tiles and in corners; smeared or warped lines; glowing halos around downlights.
5. Lighting and materials: plausible daylight direction, no blown highlights, materials consistent with the request.

Be conservative. If the images do not let you decide, say "uncertain" rather than guessing. Fine texture can be hard to see at this resolution; do not claim a surface is clean unless it clearly is.
Write every reason, problem and the summary in Traditional Chinese as used in Taiwan, short and specific (where in the frame, what is wrong).`;

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
  const { claude } = readSettings();
  if (!claude.key) throw new Error("尚未設定 Claude 金鑰，請到「設定」輸入。");
  if (!claude.model) throw new Error("尚未選擇 Claude 模型，請到「設定」按「測試並載入模型」。");
  if (!v.resultAssetId || !v.qa) throw new Error("這個版本還沒有 AI 結果可以檢查。");
  const [baseBlob, resultBlob] = await Promise.all([assetBlob(v.baseAssetId), assetBlob(v.resultAssetId)]);
  if (!baseBlob || !resultBlob) throw new Error("找不到底圖或結果圖檔案。");
  // 2048 是渲染圖原寬；再大只增加費用，看不出更多問題
  const [baseB64, resultB64] = await Promise.all([toJpegB64(baseBlob, 2048), toJpegB64(resultBlob, 2048)]);
  const checklist = v.qa.checks.map((c) => `- ${c.id}: ${c.label}`).join("\n");

  const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
  const c = await client(claude.key);
  const fallback = FALLBACK_MODELS.has(claude.model);
  // 舊款 Haiku／Sonnet 4.5 不收 effort，送了會 400
  const effortOk = !/(haiku-4|sonnet-4-5|claude-3)/.test(claude.model);
  const params = {
    model: claude.model,
    max_tokens: 16000,
    system: SYSTEM,
    ...(fallback ? { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const } : {}),
    output_config: { ...(effortOk ? { effort: claude.effort } : {}), format: betaZodOutputFormat(await reviewSchema()) },
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "IMAGE 1 — BASE (the 3D render the edit started from):" },
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: baseB64 } },
          { type: "text" as const, text: "IMAGE 2 — RESULT (after the AI edit, upscaled and aligned back to the BASE):" },
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: resultB64 } },
          {
            type: "text" as const,
            text: `${briefFor(p, v)}\n\nChecklist (give one verdict per id, keep the ids exactly):\n${checklist}\n\nAlso list every concrete issue you can see, most severe first. Return an empty list if there are none.`,
          },
        ],
      },
    ],
  };

  let res;
  try {
    res = await c.beta.messages.parse(params);
  } catch (e) {
    throw await friendlyError(e);
  }
  bumpUsage("claudeReviews");
  if (res.stop_reason === "refusal") throw new Error("Claude 的安全機制拒絕了這次檢查（可換一個模型再試）。");
  if (res.stop_reason === "max_tokens") throw new Error("Claude 的回答太長被截斷，請再試一次或把細心程度調低。");
  const out = res.parsed_output;
  if (!out) throw new Error("Claude 回傳的格式無法解析，請再試一次。");
  const known = new Set(v.qa.checks.map((x) => x.id));
  return {
    at: new Date().toISOString(),
    model: res.model,
    summary: out.summary,
    instructionsFollowed: out.instructions_followed,
    checks: out.checks.filter((x) => known.has(x.id)),
    issues: out.issues,
    usage: { input: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0), output: res.usage.output_tokens },
  };
}

/** 依實際用量估算費用（美元）；未知模型回傳 null */
export function estimateCost(model: string, usage: AiReview["usage"]): number | null {
  const price = CLAUDE_PRICE[model];
  if (!price || !usage) return null;
  return (usage.input * price.input + usage.output * price.output) / 1_000_000;
}
