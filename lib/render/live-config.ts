/**
 * AI 出圖（付費）開關。預設關閉：沒有明確設定就只能用 ChatGPT 手動模式。
 *
 * 管理員於 Vercel → Environment Variables 設定：
 * - OPENAI_API_KEY        伺服器端金鑰（不會傳到瀏覽器）
 * - RENDER_LIVE=1         確認額度與預算後才開
 * - OPENAI_IMAGE_MODEL    影像模型 ID（依 OpenAI 當期文件；未設定則拒絕呼叫，避免寫死已退役模型）
 * - OPENAI_INPUT_FIDELITY 選填，"high" / "low"（僅支援此參數的模型）
 */
export function liveConfig() {
  const key = process.env.OPENAI_API_KEY ?? "";
  const model = process.env.OPENAI_IMAGE_MODEL ?? "";
  if (process.env.RENDER_LIVE !== "1") {
    return { live: false, key, model, reason: "管理員尚未開啟 AI 付費出圖（RENDER_LIVE）。目前請用 ChatGPT 手動模式。" };
  }
  if (!key) return { live: false, key, model, reason: "伺服器未設定 OPENAI_API_KEY。" };
  if (!model) return { live: false, key, model, reason: "伺服器未設定 OPENAI_IMAGE_MODEL。" };
  return { live: true, key, model, reason: "已啟用" };
}
