import { NextRequest, NextResponse } from "next/server";
import { runReview } from "@/lib/server/claude";
import { assertUnderCap, bumpUsage, CapReachedError, resolveClaude } from "@/lib/server/company";
import { sessionUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 高細心程度下 Claude 常需 30–90 秒
export const maxDuration = 300;

const MAX_BYTES = 4.2 * 1024 * 1024;

/** Claude 看圖驗收：瀏覽器送兩張 JPEG（base64）與說明，伺服器用後台金鑰呼叫 */
export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await resolveClaude();
  if ("error" in cfg) return NextResponse.json({ error: cfg.error }, { status: 501 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return NextResponse.json({ error: "圖片過大，請重新整理後再試。" }, { status: 413 });
  }
  let body: { baseB64?: unknown; resultB64?: unknown; brief?: unknown; checklist?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "格式錯誤" }, { status: 400 });
  }
  const { baseB64, resultB64, brief, checklist } = body;
  if (typeof baseB64 !== "string" || typeof resultB64 !== "string" || typeof brief !== "string" || !Array.isArray(checklist)) {
    return NextResponse.json({ error: "缺少圖片或檢查清單。" }, { status: 400 });
  }
  const items = checklist
    .filter((c): c is { id: string; label: string } => typeof c?.id === "string" && typeof c?.label === "string")
    .slice(0, 30);
  try {
    await assertUnderCap("claudeReviews", cfg.cap);
    const review = await runReview(cfg, { baseB64, resultB64, brief: brief.slice(0, 20000), checklist: items });
    await bumpUsage("claudeReviews", user.email).catch((e: Error) => console.error("[usage] bump failed:", e.name, e.message));
    return NextResponse.json(review);
  } catch (e) {
    const status = e instanceof CapReachedError ? 429 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
