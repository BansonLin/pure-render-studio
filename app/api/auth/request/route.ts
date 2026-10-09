import { NextRequest, NextResponse } from "next/server";
import { createLoginToken, isEmailAllowed } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/auth/request  { email }
 * 白名單內：寄送 magic link（Resend）。
 * 回應一律為泛用成功訊息，不洩漏白名單成員。
 */
export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const generic = NextResponse.json({
    ok: true,
    message: "若此信箱在授權名單內，登入連結已寄出（15 分鐘內有效）。",
  });

  if (!email || !isEmailAllowed(email)) return generic;

  const token = await createLoginToken(email);
  if (!token) return generic; // AUTH_SECRET 未設 → fail-closed

  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;
  const link = `${appUrl}/api/auth/callback?token=${encodeURIComponent(token)}`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

  if (!apiKey) {
    // 開發模式：無寄信金鑰時將連結印到 server log，方便本地驗證
    if (process.env.NODE_ENV === "development") {
      console.log(`[auth] magic link for ${email}: ${link}`);
    }
    return generic;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `璞石 Render Studio <${from}>`,
        to: [email],
        subject: "登入璞石 Render Studio 渲染工作台",
        html: [
          `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">`,
          `<h2 style="color:#1c1917">璞石 Render Studio</h2>`,
          `<p>點擊下方按鈕登入（15 分鐘內有效、僅可使用一次瀏覽器 session）：</p>`,
          `<p style="margin:24px 0"><a href="${link}" style="background:#1c1917;color:#fafaf9;padding:12px 24px;border-radius:8px;text-decoration:none">登入渲染工作台</a></p>`,
          `<p style="color:#78716c;font-size:12px">若您沒有要求登入，請忽略此信。</p>`,
          `</div>`,
        ].join(""),
      }),
    });
    if (!res.ok) {
      console.error("[auth] resend error", res.status, await res.text());
    }
  } catch (e) {
    console.error("[auth] resend fetch failed", e);
  }

  return generic;
}
