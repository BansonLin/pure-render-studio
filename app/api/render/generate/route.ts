import { NextRequest, NextResponse } from "next/server";
import { assertUnderCap, bumpUsage, CapReachedError, resolveOpenAI } from "@/lib/server/company";
import { OPENAI_BASE, openaiError, outputSizeFor } from "@/lib/server/openai";
import { sessionUser } from "@/lib/server/session";

/**
 * AI 編修（OpenAI Images Edit API）。
 *
 * 金鑰來源：後台設定（加密保存）優先，其次 Vercel 環境變數（RENDER_LIVE＋OPENAI_API_KEY）。
 *
 * 防線（伺服器端強制，不只靠介面）：
 * - 沒有可用金鑰一律 501
 * - 全公司每月上限（後台設定），達上限回 429
 * - 必須帶 consent=yes（使用者確認圖片授權與付費）
 * - 每次 1 張、不自動重試；逾時回 504 + outcome=unknown，前端標記「結果未知」，不盲目重送
 * - 請求大小上限 4 MB（Vercel 函式本體限制約 4.5 MB），前端先轉 JPEG 壓縮
 *
 * 未用真金鑰實測：依官方 API 格式撰寫，需管理員設定金鑰後以小量驗收。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 高品質出圖常超過 1 分鐘；Fluid compute 上限內放寬，避免付了錢卻逾時拿不到圖
export const maxDuration = 300;

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_REFS = 4;

export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await resolveOpenAI();
  if ("error" in cfg) return NextResponse.json({ error: cfg.error }, { status: 501 });
  try {
    await assertUnderCap("openaiImages", cfg.cap);
  } catch (e) {
    if (e instanceof CapReachedError) return NextResponse.json({ error: e.message }, { status: 429 });
    throw e;
  }

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) {
    return NextResponse.json({ error: "請求超過 4 MB，請縮小參考圖。" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "表單格式錯誤" }, { status: 400 });
  }
  if (form.get("consent") !== "yes") {
    return NextResponse.json({ error: "未確認圖片授權與付費同意。" }, { status: 400 });
  }
  const prompt = String(form.get("prompt") ?? "").trim();
  const base = form.get("base");
  if (!prompt || !(base instanceof Blob)) {
    return NextResponse.json({ error: "缺少提示詞或底圖。" }, { status: 400 });
  }
  if (prompt.length > 30000) {
    return NextResponse.json({ error: "提示詞過長。" }, { status: 400 });
  }
  const refs = form.getAll("reference").filter((r): r is File => r instanceof Blob);
  if (refs.length > MAX_REFS) {
    return NextResponse.json({ error: `參考圖最多 ${MAX_REFS} 張。` }, { status: 400 });
  }
  const mask = form.get("mask");
  const quality = form.get("quality") === "medium" ? "medium" : "high";

  const upstream = new FormData();
  upstream.append("model", cfg.model);
  upstream.append("prompt", prompt);
  upstream.append("n", "1");
  const size = outputSizeFor(cfg.model, Number(form.get("width")), Number(form.get("height")));
  upstream.append("size", size);
  upstream.append("quality", quality);
  upstream.append("output_format", "jpeg");
  if (process.env.OPENAI_INPUT_FIDELITY) {
    upstream.append("input_fidelity", process.env.OPENAI_INPUT_FIDELITY);
  }
  upstream.append("image[]", base, "image_1.jpg");
  refs.forEach((r, i) => upstream.append("image[]", r, `image_${i + 2}.jpg`));
  if (mask instanceof Blob) upstream.append("mask", mask, "mask.png");

  const ac = new AbortController();
  // 比函式上限 300 秒早一點中止，才來得及回「結果未知」而不是被平台直接切斷
  const timer = setTimeout(() => ac.abort(), 285_000);
  // 用量紀錄失敗不影響出圖結果回傳
  const count = () =>
    bumpUsage("openaiImages", user.email).catch((e: Error) => console.error("[usage] bump failed:", e.name, e.message));
  try {
    const r = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}` },
      body: upstream,
      signal: ac.signal,
    });
    if (!r.ok) return NextResponse.json({ error: await openaiError(r) }, { status: 502 });
    const json = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; usage?: unknown };
    await count();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: "OpenAI 未回傳影像；請到 OpenAI 後台確認是否已計費。", outcome: "unknown" }, { status: 502 });
    return NextResponse.json({ image_b64: b64, mime: "image/jpeg", model: cfg.model, usage: json.usage ?? null });
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    if (aborted) await count();
    return NextResponse.json(
      {
        error: aborted ? "OpenAI 處理逾時；結果未知，請勿立即重送。" : "伺服器連線 OpenAI 失敗。",
        outcome: aborted ? "unknown" : "failed",
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
