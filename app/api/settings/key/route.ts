import { NextRequest, NextResponse } from "next/server";
import { decryptSecret } from "@/lib/server/crypto";
import { listClaudeModels } from "@/lib/server/claude";
import { loadCompany, publicSettings, sealKey, updateCompany } from "@/lib/server/company";
import { listOpenAIImageModels } from "@/lib/server/openai";
import { sessionUser } from "@/lib/server/session";
import { storeMode } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "openai" | "claude";
const isProvider = (p: unknown): p is Provider => p === "openai" || p === "claude";

/**
 * 設定或重新測試金鑰（管理者）。
 * 先用金鑰向供應商查模型清單：查得到才存，存的是加密後的值；回應永遠不含金鑰。
 * body: { provider, key? }，沒帶 key 表示用已存的金鑰重新測試並更新模型清單。
 */
export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "只有管理者可以設定金鑰。" }, { status: 403 });
  if (!storeMode()) return NextResponse.json({ error: "後台儲存尚未啟用。" }, { status: 503 });
  let body: { provider?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "格式錯誤" }, { status: 400 });
  }
  if (!isProvider(body.provider)) return NextResponse.json({ error: "未知的供應商" }, { status: 400 });
  const provider = body.provider;
  const fresh = typeof body.key === "string" ? body.key.trim() : "";
  if (fresh && (fresh.length < 20 || fresh.length > 300 || /\s/.test(fresh))) {
    return NextResponse.json({ error: "金鑰格式看起來不對，請整串複製貼上。" }, { status: 400 });
  }
  let key = fresh;
  if (!key) {
    const stored = (await loadCompany())[provider].key;
    if (!stored) return NextResponse.json({ error: "尚未設定金鑰。" }, { status: 400 });
    try {
      key = decryptSecret(stored.enc);
    } catch {
      return NextResponse.json({ error: "已存的金鑰無法解密（可能更換過 AUTH_SECRET），請按「更換金鑰」重新輸入。" }, { status: 400 });
    }
  }
  let models;
  try {
    models = provider === "openai" ? await listOpenAIImageModels(key) : await listClaudeModels(key);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    await updateCompany((c) => {
      const block = c[provider];
      if (fresh) block.key = sealKey(fresh, user.email);
      block.models = models;
      if (!models.some((m) => m.id === block.model)) block.model = (models.find((m) => m.recommended) ?? models[0]).id;
    });
    return NextResponse.json({ ok: true, found: models.length, settings: await publicSettings(user) });
  } catch (e) {
    // 只記錯誤種類與訊息，不含金鑰
    console.error("[settings/key] save failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ error: `金鑰測試成功，但存到後台失敗：${(e as Error).message}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "只有管理者可以清除金鑰。" }, { status: 403 });
  if (!storeMode()) return NextResponse.json({ error: "後台儲存尚未啟用。" }, { status: 503 });
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isProvider(provider)) return NextResponse.json({ error: "未知的供應商" }, { status: 400 });
  try {
    await updateCompany((c) => {
      c[provider].key = null;
      c[provider].models = [];
      c[provider].model = "";
    });
    return NextResponse.json(await publicSettings(user));
  } catch (e) {
    console.error("[settings/key] clear failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ error: `清除失敗：${(e as Error).message}` }, { status: 500 });
  }
}
