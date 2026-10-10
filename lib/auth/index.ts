import { SignJWT, jwtVerify } from "jose";

/**
 * T0 認證核心 — Email magic link（無資料庫、fail-closed）。
 *
 * 設計說明：
 * - NextAuth 的 Email provider 強制要求資料庫 adapter 存 verification token；
 *   本專案無 DB，故以 jose 簽章 JWT 實作等價的 magic link 流程。
 *   若日後確認使用 Google Workspace（待確認清單 #1），改接 NextAuth Google
 *   + JWT session 即可（Google OAuth 不需 adapter）。
 * - Fail-closed：缺任何必要環境變數時，middleware 一律視為未登入、
 *   登入信也發不出去 → 全站鎖死。因此「先部署、後補環境變數」是安全的。
 *
 * 必要環境變數（設定於 Vercel Project Settings → Environment Variables）：
 * - AUTH_SECRET      32+ 字元隨機字串（openssl rand -base64 32）
 * - ALLOWED_EMAILS   白名單，逗號分隔（使用工作台的設計師與主管）
 * - RESEND_API_KEY   resend.com 免費方案 API key（寄送登入信）
 * - EMAIL_FROM       寄件位址，如 render@puregroup.com.tw 或 onboarding@resend.dev
 * - APP_URL          正式網址，如 https://pure-render-studio.vercel.app
 */

export const SESSION_COOKIE = "render_session";
const SESSION_DAYS = 30;
const LOGIN_TOKEN_MINUTES = 15;

function secretKey(): Uint8Array | null {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) return null;
  return new TextEncoder().encode(s);
}

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string): boolean {
  return allowedEmails().includes(email.trim().toLowerCase());
}

/** 簽發一次性登入 token（15 分鐘、用途綁定） */
export async function createLoginToken(email: string): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ email: email.trim().toLowerCase(), purpose: "login" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LOGIN_TOKEN_MINUTES}m`)
    .sign(key);
}

/** 驗證登入 token，回傳 email（無效回 null） */
export async function verifyLoginToken(token: string): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    if (payload.purpose !== "login" || typeof payload.email !== "string") {
      return null;
    }
    // token 有效仍需仍在白名單（白名單可能事後移除人員）
    if (!isEmailAllowed(payload.email)) return null;
    return payload.email;
  } catch {
    return null;
  }
}

/** 簽發 30 天 session JWT */
export async function createSessionToken(email: string): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ email, purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key);
}

/** 驗證 session（middleware 與 server component 共用；edge 相容） */
export async function verifySessionToken(
  token: string | undefined,
): Promise<{ email: string } | null> {
  if (!token) return null;
  const key = secretKey();
  if (!key) return null; // fail-closed：無密鑰即無有效 session
  try {
    const { payload } = await jwtVerify(token, key);
    if (payload.purpose !== "session" || typeof payload.email !== "string") {
      return null;
    }
    if (!isEmailAllowed(payload.email)) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/**
 * 管理者（可改後台金鑰與公司設定）。ADMIN_EMAILS 未設定時只有白名單第一位，
 * 避免新加入的設計師預設就能換掉公司金鑰。
 */
export function isAdminEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length) return admins.includes(e);
  return allowedEmails()[0] === e;
}
