import type { ModelOption } from "@/lib/render/company-types";

// 測試時可指向本機模擬伺服器；正式環境不設
export const OPENAI_BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

/** 已知影像模型的排序與說明；清單以外的模型照字母排在後面 */
const OPENAI_IMAGE_HINTS: Record<string, { rank: number; note: string }> = {
  "gpt-image-2": { rank: 0, note: "最新旗艦，品質最好" },
  "gpt-image-1.5": { rank: 1, note: "上一代，較便宜" },
  "gpt-image-1-mini": { rank: 2, note: "最便宜，細節較弱" },
  "gpt-image-1": { rank: 3, note: "舊版，據報即將退役" },
};

export async function openaiError(res: Response): Promise<string> {
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
    res = await fetch(`${OPENAI_BASE}/models`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  } catch {
    throw new Error("伺服器連不到 OpenAI，請稍後再試。");
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
 * 輸出尺寸。gpt-image-2 系列可指定任意尺寸（邊長 16 的倍數、長邊 ≤ 3840、總像素 655,360–8,294,400、
 * 長短邊比 ≤ 3:1），要求與底圖同尺寸，省掉縮放與裁切；舊模型只有固定幾種尺寸，交給 auto。
 */
export function outputSizeFor(model: string, width: number, height: number): string {
  if (!model.startsWith("gpt-image-2") || !(width > 0 && height > 0)) return "auto";
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short > 3) return "auto";
  let k = Math.min(1, 3840 / long);
  let w = Math.round((width * k) / 16) * 16;
  let h = Math.round((height * k) / 16) * 16;
  if (w * h < 655_360) {
    k = Math.sqrt(655_360 / (w * h));
    w = Math.ceil((w * k) / 16) * 16;
    h = Math.ceil((h * k) / 16) * 16;
  }
  if (w * h > 8_294_400) return "auto";
  return `${w}x${h}`;
}
