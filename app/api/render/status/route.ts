import { NextResponse } from "next/server";
import { liveConfig } from "@/lib/render/live-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const c = liveConfig();
  return NextResponse.json({ live: c.live, model: c.live ? c.model : null, reason: c.reason });
}
