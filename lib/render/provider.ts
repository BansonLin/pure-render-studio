"use client";

import { base64ToBlob } from "./image";

/**
 * 影像供應商轉接層。
 *
 * - manual：ChatGPT 手動模式（零 API 成本）。匯出任務包 → 設計師在 ChatGPT 上傳＋貼提示詞
 *   → 下載結果 → 匯回。網頁版不能上傳遮罩，所以靠「座標描述＋匯回後選區外回貼」控制範圍。
 * - openai：OpenAI Images Edit API。本裝置在「設定」存了金鑰就由瀏覽器直接呼叫（不受伺服器
 *   60 秒、4 MB 限制，金鑰也不經過璞石伺服器）；否則走伺服器路由（需 RENDER_LIVE=1）。
 *
 * 能力不支援就明說，不靜默丟棄限制。
 */

export type ProviderId = "manual" | "openai";

export interface ProviderCaps {
  label: string;
  mask: boolean;
  maxReferences: number;
  note: string;
}

export const PROVIDER_CAPS: Record<ProviderId, ProviderCaps> = {
  manual: {
    label: "ChatGPT 手動模式",
    mask: false,
    maxReferences: 6,
    note: "無遮罩：以座標描述選區，匯回後系統回貼選區外像素。",
  },
  openai: {
    label: "OpenAI API",
    mask: true,
    maxReferences: 4,
    note: "支援遮罩與多參考圖；每次 1 張、不自動重試、會計費。",
  },
};

export interface LiveStatus {
  live: boolean;
  model: string | null;
  reason: string;
}

export async function fetchLiveStatus(): Promise<LiveStatus> {
  try {
    const r = await fetch("/api/render/status", { cache: "no-store" });
    if (!r.ok) return { live: false, model: null, reason: `狀態查詢失敗（${r.status}）` };
    return (await r.json()) as LiveStatus;
  } catch {
    return { live: false, model: null, reason: "無法連線伺服器" };
  }
}

export interface ApiGenerateInput {
  requestId: string;
  prompt: string;
  base: Blob;
  mask: Blob | null;
  references: Blob[];
  quality: "medium" | "high";
}

export interface ApiGenerateOutput {
  image: Blob;
  model: string | null;
  usage: unknown;
}

export class OutcomeUnknownError extends Error {}

export async function generateViaApi(input: ApiGenerateInput): Promise<ApiGenerateOutput> {
  const fd = new FormData();
  fd.append("requestId", input.requestId);
  fd.append("prompt", input.prompt);
  fd.append("quality", input.quality);
  fd.append("consent", "yes");
  fd.append("base", input.base, "base.jpg");
  if (input.mask) fd.append("mask", input.mask, "mask.png");
  input.references.forEach((r, i) => fd.append("reference", r, `ref_${i + 1}.jpg`));
  let res: Response;
  try {
    res = await fetch("/api/render/generate", { method: "POST", body: fd });
  } catch {
    // 連線中斷：供應商可能已在計費處理中，不可自動重送
    throw new OutcomeUnknownError("連線中斷，無法確認供應商是否已產生結果。");
  }
  const json = (await res.json().catch(() => ({}))) as {
    image_b64?: string;
    mime?: string;
    model?: string;
    usage?: unknown;
    error?: string;
    outcome?: string;
  };
  if (!res.ok || !json.image_b64) {
    if (json.outcome === "unknown" || res.status === 504) {
      throw new OutcomeUnknownError(json.error ?? "逾時，結果未知。");
    }
    throw new Error(json.error ?? `生成失敗（${res.status}）`);
  }
  return {
    image: base64ToBlob(json.image_b64, json.mime ?? "image/jpeg"),
    model: json.model ?? null,
    usage: json.usage ?? null,
  };
}

// ---- 瀏覽器直連 OpenAI（金鑰來自本裝置設定） ----

const OPENAI = "https://api.openai.com/v1";

export interface ModelOption {
  id: string;
  label: string;
  note?: string;
  recommended?: boolean;
}

/** 已知影像模型的排序與說明；清單以外的模型照字母排在後面 */
const OPENAI_IMAGE_HINTS: Record<string, { rank: number; note: string }> = {
  "gpt-image-2": { rank: 0, note: "最新旗艦，品質最好" },
  "gpt-image-1.5": { rank: 1, note: "上一代，較便宜" },
  "gpt-image-1-mini": { rank: 2, note: "最便宜，細節較弱" },
  "gpt-image-1": { rank: 3, note: "舊版，據報即將退役" },
};

async function openaiError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const msg = j.error?.message ?? "";
  if (res.status === 401) return "OpenAI 金鑰無效或已被撤銷。";
  if (res.status === 403 && /verif/i.test(msg)) return "OpenAI 要求先完成「組織驗證」才能用影像模型：OpenAI 後台 → Settings → Organization → Verify。";
  if (res.status === 429) return "OpenAI 額度不足或請求太頻繁（請檢查帳戶餘額與用量上限）。";
  return `OpenAI 回應錯誤（${res.status}）：${msg || "未知"}`;
}

export async function listOpenAIImageModels(key: string): Promise<ModelOption[]> {
  let res: Response;
  try {
    res = await fetch(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    throw new Error("瀏覽器連不到 OpenAI（網路問題，或 OpenAI 拒絕瀏覽器直連；後者請改用伺服器共用金鑰，見設定說明）。");
  }
  if (!res.ok) throw new Error(await openaiError(res));
  const j = (await res.json()) as { data?: { id: string }[] };
  const ids = (j.data ?? []).map((m) => m.id).filter((id) => /^(gpt-image|chatgpt-image)/.test(id));
  if (!ids.length) throw new Error("這把金鑰看不到任何影像模型（帳戶可能尚未開通或未完成組織驗證）。");
  const rank = (id: string) => OPENAI_IMAGE_HINTS[id]?.rank ?? 99;
  ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return ids.map((id, i) => ({ id, label: id, note: OPENAI_IMAGE_HINTS[id]?.note, recommended: i === 0 }));
}

/**
 * 瀏覽器直接呼叫 OpenAI 影像編輯。與伺服器路由同樣的防線：每次 1 張、不自動重試；
 * 連線在送出後中斷時無法得知是否已計費，一律標成「結果未知」讓使用者去後台確認。
 */
export async function generateViaOpenAIDirect(
  input: ApiGenerateInput,
  cfg: { key: string; model: string },
): Promise<ApiGenerateOutput> {
  const fd = new FormData();
  fd.append("model", cfg.model);
  fd.append("prompt", input.prompt);
  fd.append("n", "1");
  fd.append("size", "auto");
  fd.append("quality", input.quality);
  fd.append("output_format", "jpeg");
  fd.append("image[]", input.base, "image_1.jpg");
  input.references.forEach((r, i) => fd.append("image[]", r, `image_${i + 2}.jpg`));
  if (input.mask) fd.append("mask", input.mask, "mask.png");
  let res: Response;
  try {
    res = await fetch(`${OPENAI}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${cfg.key}` }, body: fd });
  } catch {
    throw new OutcomeUnknownError("連線中斷，無法確認 OpenAI 是否已產生結果。");
  }
  if (!res.ok) throw new Error(await openaiError(res));
  const j = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; usage?: unknown };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new OutcomeUnknownError("OpenAI 回應沒有影像；請到 OpenAI 後台確認是否已計費。");
  return { image: base64ToBlob(b64, "image/jpeg"), model: cfg.model, usage: j.usage ?? null };
}
