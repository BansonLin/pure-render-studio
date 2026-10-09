import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * T0 全站路由保護（fail-closed）。
 * 未登入（或環境變數未設定）一律導向 /login。
 */
export async function middleware(req: NextRequest) {
  const session = await verifySessionToken(
    req.cookies.get(SESSION_COOKIE)?.value,
  );
  if (session) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  // API 請求回 401 而非 redirect
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 保護所有路由，僅豁免：登入頁、auth API、Next 靜態資源、圖示
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|icon.svg|favicon.ico).*)",
  ],
};
