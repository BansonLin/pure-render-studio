"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get("error");
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || state === "sending") return;
    setState("sending");
    try {
      await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setState("sent");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground text-background">
            <span className="text-lg font-bold">璞</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              璞石 Render Studio 渲染工作台
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              限授權人員使用 · 以 Email 登入
            </p>
          </div>
        </div>

        {urlError === "invalid" && (
          <p className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-center text-sm text-danger">
            登入連結無效或已過期，請重新申請。
          </p>
        )}
        {urlError === "config" && (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-center text-sm text-warning">
            系統尚未完成設定，請聯絡管理員。
          </p>
        )}

        {state === "sent" ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm font-medium">
              若此信箱在授權名單內，
              <br />
              登入連結已寄出（15 分鐘內有效）。
            </p>
            <p className="text-xs text-muted-foreground">
              請檢查收件匣與垃圾信件夾。
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              連結在哪個瀏覽器打開，就登入在哪個瀏覽器：
              <br />
              請在要使用的這台裝置，用 Safari／Chrome 開啟；
              <br />
              在 Gmail、LINE 內建瀏覽器開啟時，請選「在瀏覽器中開啟」。
            </p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-3 rounded-xl border border-border bg-card p-6"
          >
            <label
              htmlFor="email"
              className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
            <Button type="submit" className="w-full" disabled={state === "sending"}>
              {state === "sending" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Mail />
              )}
              寄送登入連結
            </Button>
          </form>
        )}

        <p className="text-center text-xs text-muted-foreground">
          璞石集團 PURE GROUP · 內部系統
        </p>
      </div>
    </main>
  );
}
