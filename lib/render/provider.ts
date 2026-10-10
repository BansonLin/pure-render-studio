"use client";

import { base64ToBlob } from "./image";
export type { ModelOption } from "./company-types";

/**
 * 影像供應商轉接層。
 *
 * - manual：ChatGPT 手動模式（零 API 成本）。匯出任務包 → 設計師在 ChatGPT 上傳＋貼提示詞
 *   → 下載結果 → 匯回。網頁版不能上傳遮罩，所以靠「座標描述＋匯回後選區外回貼」控制範圍。
 * - openai：OpenAI Images Edit API，一律經伺服器路由；金鑰在後台（管理者於「設定」輸入，加密保存），
 *   瀏覽器拿不到金鑰。
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
  /** 底圖像素尺寸：伺服器據此向支援自訂尺寸的模型要求同尺寸輸出 */
  width: number;
  height: number;
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
  fd.append("width", String(input.width));
  fd.append("height", String(input.height));
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
