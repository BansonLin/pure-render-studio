import { NextRequest, NextResponse } from "next/server";
import type { ClaudeEffort, OpenAIQuality, RoomPreset } from "@/lib/render/company-types";
import { publicSettings, updateCompany } from "@/lib/server/company";
import { storeMode } from "@/lib/server/store";
import { sessionUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await publicSettings(user));
  } catch (e) {
    return NextResponse.json({ error: `讀取後台設定失敗：${(e as Error).message}` }, { status: 500 });
  }
}

const CAPS = new Set([10, 20, 50, 100, 200, 300, 500, 1000]);
const capOk = (v: unknown) => v === null || (typeof v === "number" && CAPS.has(v));

interface Patch {
  openai?: { model?: string; quality?: OpenAIQuality; monthlyCap?: number | null };
  claude?: { model?: string; effort?: ClaudeEffort; monthlyCap?: number | null };
  rooms?: RoomPreset[];
}

/** 管理者修改模型、品質、上限、空間預設（金鑰另走 /api/settings/key） */
export async function PATCH(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "只有管理者可以修改公司設定。" }, { status: 403 });
  if (!storeMode()) return NextResponse.json({ error: "後台儲存尚未啟用。" }, { status: 503 });
  let body: Patch;
  try {
    body = (await req.json()) as Patch;
  } catch {
    return NextResponse.json({ error: "格式錯誤" }, { status: 400 });
  }
  if (body.openai?.monthlyCap !== undefined && !capOk(body.openai.monthlyCap)) return NextResponse.json({ error: "上限數值不在選項內" }, { status: 400 });
  if (body.claude?.monthlyCap !== undefined && !capOk(body.claude.monthlyCap)) return NextResponse.json({ error: "上限數值不在選項內" }, { status: 400 });
  if (body.rooms) {
    const names = body.rooms.map((r) => String(r.name ?? "").trim());
    if (names.some((n) => !n || n.length > 20)) return NextResponse.json({ error: "空間名稱不可空白，且最多 20 字。" }, { status: 400 });
    if (new Set(names).size !== names.length) return NextResponse.json({ error: "空間名稱有重複。" }, { status: 400 });
    if (body.rooms.some((r) => r.startNo !== null && !(Number.isInteger(r.startNo) && r.startNo >= 0 && r.startNo < 100000)))
      return NextResponse.json({ error: "起始圖號需為 0–99999 的整數或留空。" }, { status: 400 });
  }
  try {
    await updateCompany((c) => {
      const o = body.openai;
      if (o?.model !== undefined && c.openai.models.some((m) => m.id === o.model)) c.openai.model = o.model;
      if (o?.quality === "medium" || o?.quality === "high") c.openai.extra.quality = o.quality;
      if (o?.monthlyCap !== undefined) c.openai.monthlyCap = o.monthlyCap;
      const a = body.claude;
      if (a?.model !== undefined && c.claude.models.some((m) => m.id === a.model)) c.claude.model = a.model;
      if (a?.effort === "medium" || a?.effort === "high" || a?.effort === "xhigh") c.claude.extra.effort = a.effort;
      if (a?.monthlyCap !== undefined) c.claude.monthlyCap = a.monthlyCap;
      if (body.rooms) c.rooms = body.rooms.map((r) => ({ name: r.name.trim(), startNo: r.startNo }));
    });
    return NextResponse.json(await publicSettings(user));
  } catch (e) {
    console.error("[settings] patch failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ error: `儲存失敗：${(e as Error).message}` }, { status: 500 });
  }
}
