import type { GoogleImageSize, ModelOption } from "@/lib/render/company-types";

/**
 * Google Gemini 影像模型（Nano Banana 系列）。金鑰從後台解密後只在這裡使用。
 * 2026-10 Luma 調查：Luma 上效果最好的圖其實是 Nano Banana Pro 出的，所以直接接 Google，
 * 不經 Luma（Luma API 只開放自家模型），也避開一般訂閱條款允許拿上傳內容訓練的問題。
 */

// 測試時可指向本機模擬伺服器；正式環境不設
export const GOOGLE_BASE = process.env.GOOGLE_AI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";

/** 模型名稱會隨版本改，用關鍵字排序；清單以外的照字母排在後面 */
function hintFor(id: string): { rank: number; note?: string } {
  if (/pro-image/.test(id)) return { rank: 0, note: "Nano Banana Pro：寫實度最好（Luma 實測主力）" };
  if (/flash-lite-image/.test(id)) return { rank: 3, note: "Nano Banana Lite：最便宜，細節較弱" };
  if (/flash-image/.test(id)) return { rank: 1, note: "Nano Banana 2：較快、較便宜" };
  return { rank: 9 };
}

export async function googleError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
  const msg = j.error?.message ?? "";
  if (res.status === 400 && /api key/i.test(msg)) return "Google 金鑰無效或已被撤銷。";
  if (res.status === 401 || res.status === 403) return `Google 拒絕這把金鑰（${res.status}）：${msg || "權限不足或專案未啟用 Gemini API"}`;
  if (res.status === 429) return "Google 額度不足或請求太頻繁（請確認專案已綁定付費帳戶）。";
  return `Google 回應錯誤（${res.status}）：${msg || "未知"}`;
}

export async function listGoogleImageModels(key: string): Promise<ModelOption[]> {
  const found: { id: string; label: string }[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    let res: Response;
    try {
      const qs = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
      res = await fetch(`${GOOGLE_BASE}/models?${qs}`, { headers: { "x-goog-api-key": key }, cache: "no-store" });
    } catch {
      throw new Error("伺服器連不到 Google，請稍後再試。");
    }
    if (!res.ok) throw new Error(await googleError(res));
    const j = (await res.json()) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of j.models ?? []) {
      const id = m.name.replace(/^models\//, "");
      // Imagen 只能從文字生圖、不能改圖；只收走 generateContent 的影像模型
      if (!/image/.test(id) || /imagen/.test(id)) continue;
      if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes("generateContent")) continue;
      found.push({ id, label: m.displayName || id });
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  if (!found.length) throw new Error("這把金鑰看不到任何可改圖的 Gemini 影像模型（請確認專案已啟用 Gemini API）。");
  found.sort((a, b) => hintFor(a.id).rank - hintFor(b.id).rank || a.id.localeCompare(b.id));
  return found.map((m, i) => ({ id: m.id, label: m.label, note: hintFor(m.id).note, recommended: i === 0 && hintFor(m.id).rank === 0 }));
}

const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** 模型只收固定幾種比例；挑最接近底圖的，匯入時再對位回原尺寸 */
export function aspectFor(width: number, height: number): string {
  if (!(width > 0 && height > 0)) return "16:9";
  const want = Math.log(width / height);
  let best = RATIOS[0];
  let diff = Infinity;
  for (const r of RATIOS) {
    const [a, b] = r.split(":").map(Number);
    const d = Math.abs(Math.log(a / b) - want);
    if (d < diff) {
      diff = d;
      best = r;
    }
  }
  return best;
}

export interface GoogleEditInput {
  prompt: string;
  base: Blob;
  references: Blob[];
  width: number;
  height: number;
  signal: AbortSignal;
}

type Part = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };

const b64 = async (b: Blob) => Buffer.from(await b.arrayBuffer()).toString("base64");

/**
 * Google 回 PNG，2K 一張常有 6–9 MB，超過 Vercel 函式回應約 4.5 MB 的上限，付了錢卻送不回瀏覽器。
 * 轉成 JPEG（長邊最多 2752，即 2K）再回傳；匯入時本來就會縮放回底圖尺寸，不損失可用細節。
 */
async function toJpeg(buf: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const resized = sharp(buf).rotate().resize({ width: 2752, height: 2752, fit: "inside", withoutEnlargement: true });
  let out = await resized.clone().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  if (out.length > 3_000_000) out = await resized.clone().jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  return out;
}

/**
 * 圖生圖：底圖排第一、參考圖依序在後，每張前面標號，與提示詞裡的 image 1、image 2… 對得上。
 * Google 有回應卻沒給圖時（多半是安全機制擋下）回 ok: false，並附上 Google 給的原因。
 */
export async function editWithGoogle(
  cfg: { key: string; model: string; size: GoogleImageSize },
  input: GoogleEditInput,
): Promise<{ ok: true; b64: string; mime: string; usage: unknown } | { ok: false; status: number; error: string }> {
  const parts: Part[] = [{ text: "Image 1 (the ONLY edit target):" }, { inline_data: { mime_type: "image/jpeg", data: await b64(input.base) } }];
  for (let i = 0; i < input.references.length; i++) {
    parts.push({ text: `Image ${i + 2} (reference only, never the edit target):` });
    parts.push({ inline_data: { mime_type: "image/jpeg", data: await b64(input.references[i]) } });
  }
  parts.push({ text: input.prompt });
  const res = await fetch(`${GOOGLE_BASE}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": cfg.key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: aspectFor(input.width, input.height), imageSize: cfg.size },
      },
    }),
    signal: input.signal,
  });
  if (!res.ok) return { ok: false, status: res.status, error: await googleError(res) };
  const j = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: unknown;
  };
  // 思考過程可能夾帶草稿圖（thought: true）；取最後一張正式輸出
  const imgs = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && (p.inlineData?.data || p.inline_data?.data));
  const last = imgs.at(-1);
  if (last) {
    const jpeg = await toJpeg(Buffer.from((last.inlineData?.data ?? last.inline_data?.data)!, "base64"));
    return { ok: true, b64: jpeg.toString("base64"), mime: "image/jpeg", usage: j.usageMetadata ?? null };
  }
  const why = j.promptFeedback?.blockReason ?? j.candidates?.[0]?.finishReason ?? "未知";
  return { ok: false, status: 502, error: `Google 沒有產生圖片（原因：${why}）。多半是安全機制誤判，可改寫指令或換模型再試。` };
}
