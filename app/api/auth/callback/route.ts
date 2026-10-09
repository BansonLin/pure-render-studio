import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifyLoginToken,
} from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/auth/callback?token=... — 驗證 magic link、設定 session、導向首頁 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const email = await verifyLoginToken(token);

  if (!email) {
    return NextResponse.redirect(new URL("/login?error=invalid", req.url));
  }

  const session = await createSessionToken(email);
  if (!session) {
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
