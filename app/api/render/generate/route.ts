import { NextRequest, NextResponse } from "next/server";
import { liveConfig } from "@/lib/render/live-config";

/**
 * AI 編修（OpenAI Images Edit API）。
 *
 * 防線（伺服器端強制，不只靠介面）：
 * - 未開啟 RENDER_LIVE 一律 501
 * - 必須帶 consent=yes（使用者確認圖片授權與付費）
 * - 每次 1 張、不自動重試；逾時回 504 + outcome=unknown，前端標記「結果未知」，不盲目重送
 * - 請求大小上限 4 MB（Vercel 函式本體限制約 4.5 MB），前端先轉 JPEG 壓縮
 *
 * 未實測：本路由依官方 API 格式撰寫，需管理員設定金鑰後以小量驗收。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_REFS = 4;

export async function POST(req: NextRequest) {
  const cfg = liveConfig();
  if (!cfg.live) return NextResponse.json({ error: cfg.reason }, { status: 501 });

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
  upstream.append("size", "auto");
  upstream.append("quality", quality);
  upstream.append("output_format", "jpeg");
  if (process.env.OPENAI_INPUT_FIDELITY) {
    upstream.append("input_fidelity", process.env.OPENAI_INPUT_FIDELITY);
  }
  upstream.append("image[]", base, "image_1.jpg");
  refs.forEach((r, i) => upstream.append("image[]", r, `image_${i + 2}.jpg`));
  if (mask instanceof Blob) upstream.append("mask", mask, "mask.png");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 55_000);
  try {
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}` },
      body: upstream,
      signal: ac.signal,
    });
    const json = (await r.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[];
      usage?: unknown;
      error?: { message?: string };
    };
    if (!r.ok) {
      return NextResponse.json(
        { error: `供應商錯誤（${r.status}）：${json.error?.message ?? "未知"}` },
        { status: 502 },
      );
    }
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: "供應商未回傳影像。" }, { status: 502 });
    return NextResponse.json({ image_b64: b64, mime: "image/jpeg", model: cfg.model, usage: json.usage ?? null });
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    return NextResponse.json(
      {
        error: aborted ? "供應商處理逾時；結果未知，請勿立即重送。" : "連線供應商失敗。",
        outcome: aborted ? "unknown" : "failed",
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
