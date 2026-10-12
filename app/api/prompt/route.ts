import { NextRequest, NextResponse } from "next/server";
import { writeEditPrompt } from "@/lib/server/claude";
import { assertUnderCap, bumpUsage, CapReachedError, resolveClaude } from "@/lib/server/company";
import { sessionUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 4.2 * 1024 * 1024;
const MAX_REFS = 6;

/** Claude 精簡指令：瀏覽器送底圖、參考圖（JPEG base64）與說明，伺服器用後台金鑰呼叫；與驗收共用 Claude 月上限 */
export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await resolveClaude();
  if ("error" in cfg) return NextResponse.json({ error: cfg.error }, { status: 501 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return NextResponse.json({ error: "圖片過大，請減少參考圖後再試。" }, { status: 413 });
  }
  let body: { baseB64?: unknown; references?: unknown; brief?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "格式錯誤" }, { status: 400 });
  }
  const { baseB64, references, brief } = body;
  if (typeof baseB64 !== "string" || typeof brief !== "string" || !Array.isArray(references)) {
    return NextResponse.json({ error: "缺少底圖或說明。" }, { status: 400 });
  }
  const refs = references.filter((r): r is { b64: string; label: string } => typeof r?.b64 === "string" && typeof r?.label === "string");
  if (refs.length > MAX_REFS) return NextResponse.json({ error: `參考圖最多 ${MAX_REFS} 張。` }, { status: 400 });
  try {
    await assertUnderCap("claudeReviews", cfg.cap);
    const out = await writeEditPrompt(cfg, { baseB64, references: refs.map((r) => ({ b64: r.b64, label: r.label.slice(0, 300) })), brief: brief.slice(0, 20000) });
    await bumpUsage("claudeReviews", user.email).catch((e: Error) => console.error("[usage] bump failed:", e.name, e.message));
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof CapReachedError ? 429 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
