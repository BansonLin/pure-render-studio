import { NextResponse } from "next/server";
import { resolveOpenAI } from "@/lib/server/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const c = await resolveOpenAI().catch((e: Error) => ({ error: e.message }));
  if ("error" in c) return NextResponse.json({ live: false, model: null, reason: c.error });
  return NextResponse.json({ live: true, model: c.model, reason: "已啟用" });
}
