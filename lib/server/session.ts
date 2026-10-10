import type { NextRequest } from "next/server";
import { isAdminEmail, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/** middleware 已擋未登入；這裡再取一次 email，給權限判斷與用量紀錄用 */
export async function sessionUser(req: NextRequest): Promise<{ email: string; isAdmin: boolean } | null> {
  const s = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  return { email: s.email, isAdmin: isAdminEmail(s.email) };
}
