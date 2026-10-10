import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ModelOption } from "@/lib/render/company-types";

/**
 * Claude 看圖驗收（伺服器端）。金鑰從後台解密後只在這裡使用。
 * 不自動重試：與出圖同一原則，花錢的請求失敗就停下來讓人決定。
 */

const CLAUDE_HINTS: Record<string, { rank: number; note: string }> = {
  "claude-opus-5-5": { rank: 0, note: "建議：看圖最仔細" },
  "claude-sonnet-5-5": { rank: 1, note: "較快，約一半價格" },
  "claude-haiku-5-5": { rank: 2, note: "最便宜，只適合粗篩" },
  "claude-fable-5-1": { rank: 3, note: "最強，價格約 Opus 的 2.5 倍" },
};

// 這幾個模型支援伺服器端 fallback：遇到安全分類誤擋時自動換模型重跑，不必使用者重送
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const client = (key: string) => new Anthropic({ apiKey: key, maxRetries: 0 });

export function friendlyClaudeError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error("Claude 金鑰無效或已被撤銷。");
  if (e instanceof Anthropic.PermissionDeniedError) return new Error("這把 Claude 金鑰沒有使用此模型的權限。");
  if (e instanceof Anthropic.NotFoundError) return new Error("找不到此 Claude 模型，請管理者到「設定」重新選擇。");
  if (e instanceof Anthropic.RateLimitError) return new Error("Claude 請求太頻繁或額度不足，請稍後再試。");
  if (e instanceof Anthropic.BadRequestError) return new Error(`Claude 拒絕此請求：${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new Error("伺服器連不到 Anthropic，請稍後再試。");
  if (e instanceof Anthropic.APIError) return new Error(`Claude 回應錯誤（${e.status ?? "?"}）：${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

export async function listClaudeModels(key: string): Promise<ModelOption[]> {
  const found: { id: string; label: string; created: string }[] = [];
  try {
    for await (const m of client(key).models.list()) {
      const caps = (m as unknown as { capabilities?: { image_input?: { supported?: boolean } } }).capabilities;
      if (caps?.image_input && caps.image_input.supported === false) continue;
      found.push({ id: m.id, label: m.display_name || m.id, created: String(m.created_at) });
    }
  } catch (e) {
    throw friendlyClaudeError(e);
  }
  if (!found.length) throw new Error("這把金鑰看不到任何可看圖的 Claude 模型。");
  const rank = (id: string) => CLAUDE_HINTS[id]?.rank ?? 99;
  found.sort((a, b) => rank(a.id) - rank(b.id) || b.created.localeCompare(a.created));
  return found.map((m, i) => ({ id: m.id, label: m.label, note: CLAUDE_HINTS[m.id]?.note, recommended: i === 0 && rank(m.id) === 0 }));
}

const ReviewSchema = z.object({
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

export interface ReviewInput {
  baseB64: string;
  resultB64: string;
  brief: string;
  checklist: { id: string; label: string }[];
}

export async function runReview(cfg: { key: string; model: string; effort: "medium" | "high" | "xhigh" }, input: ReviewInput) {
  const fallback = FALLBACK_MODELS.has(cfg.model);
  // 舊款 Haiku／Sonnet 4.5 不收 effort，送了會 400
  const effortOk = !/(haiku-4|sonnet-4-5|claude-3)/.test(cfg.model);
  const checklist = input.checklist.map((c) => `- ${c.id}: ${c.label}`).join("\n");
  let res;
  try {
    res = await client(cfg.key).beta.messages.parse({
      model: cfg.model,
      max_tokens: 16000,
      system: SYSTEM,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const } : {}),
      output_config: { ...(effortOk ? { effort: cfg.effort } : {}), format: betaZodOutputFormat(ReviewSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "IMAGE 1 — BASE (the 3D render the edit started from):" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.baseB64 } },
            { type: "text", text: "IMAGE 2 — RESULT (after the AI edit, upscaled and aligned back to the BASE):" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.resultB64 } },
            {
              type: "text",
              text: `${input.brief}\n\nChecklist (give one verdict per id, keep the ids exactly):\n${checklist}\n\nAlso list every concrete issue you can see, most severe first. Return an empty list if there are none.`,
            },
          ],
        },
      ],
    });
  } catch (e) {
    throw friendlyClaudeError(e);
  }
  if (res.stop_reason === "refusal") throw new Error("Claude 的安全機制拒絕了這次檢查（可請管理者換一個模型再試）。");
  if (res.stop_reason === "max_tokens") throw new Error("Claude 的回答太長被截斷，請再試一次或請管理者把細心程度調低。");
  const out = res.parsed_output;
  if (!out) throw new Error("Claude 回傳的格式無法解析，請再試一次。");
  const known = new Set(input.checklist.map((x) => x.id));
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
