"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, CheckCircle2, KeyRound, Loader2, Plus, RotateCcw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { inputCls, useBusy, useToast } from "@/components/render/primitives";
import { clearProviderKey, patchCompany, saveProviderKey, useCompany } from "@/lib/render/company";
import { CLAUDE_PRICE } from "@/lib/render/claude";
import {
  DEFAULT_ROOMS,
  type ClaudeEffort,
  type OpenAIQuality,
  type PublicProvider,
  type PublicSettings,
  type RoomPreset,
} from "@/lib/render/company-types";

const CAP_OPTIONS: (number | null)[] = [10, 20, 50, 100, 200, 300, 500, 1000, null];
const fmtTime = (t: string | null) => (t ? new Date(t).toLocaleString("zh-TW", { hour12: false }) : "");

export function SettingsPanel() {
  const { data: s, error } = useCompany();
  const toast = useToast();
  const { busy, run } = useBusy(toast);

  if (error) return <p className="m-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</p>;
  if (!s) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 讀取後台設定…
      </div>
    );
  }
  const admin = s.isAdmin && s.storeReady;
  const patch = (body: unknown) => run("patch", () => patchCompany(body));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 p-4 sm:p-6">
      {toast.node}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">金鑰與公司預設存在後台，輸入一次，所有電腦、平板、同事都能直接使用。</p>
      </div>

      {!s.storeReady && (
        <p className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-warning">後台儲存尚未啟用，暫時無法保存設定。請聯絡開發者。</p>
      )}
      {s.storeReady && !s.isAdmin && (
        <p className="rounded-xl border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
          你目前以 {s.email} 登入，可以查看狀態；只有管理者可以修改金鑰與公司預設。
        </p>
      )}

      <div className="flex gap-3 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed">
        <ShieldCheck className="h-5 w-5 shrink-0 text-success" />
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          <li>
            金鑰<strong className="text-foreground">加密</strong>存在璞石後台（Vercel 私有儲存），之後任何人（包括管理者自己）都只看得到末四碼。
          </li>
          <li>出圖與驗收由伺服器代為呼叫 OpenAI／Anthropic，金鑰不會傳到任何人的瀏覽器，也不會進專案備份。</li>
          <li>全公司每月上限由伺服器把關；也請在 OpenAI、Anthropic 後台各設一個花費上限，雙重保險。</li>
        </ul>
      </div>

      <ProviderCard
        provider="openai"
        title="OpenAI（AI 出圖）"
        purpose="版本頁「2 生成」選「OpenAI API」即可直接出圖、自動匯入。"
        placeholder="sk-…"
        info={s.openai}
        admin={admin}
        getKeyHref="https://platform.openai.com/api-keys"
        getKeyLabel="OpenAI 後台 → API keys"
        onModel={(model) => patch({ openai: { model } })}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="預設品質">
            <select
              className={inputCls}
              disabled={!admin || !!busy}
              value={s.openai.extra.quality}
              onChange={(e) => patch({ openai: { quality: e.target.value as OpenAIQuality } })}
            >
              <option value="high">高品質（建議，較貴）</option>
              <option value="medium">標準（約 1/4 價格）</option>
            </select>
          </Field>
          <CapField value={s.openai.monthlyCap} unit="張" disabled={!admin || !!busy} onChange={(monthlyCap) => patch({ openai: { monthlyCap } })} />
          <Field label="本月已用（全公司）">
            <p className="py-1.5 text-sm font-semibold">
              {s.usage.openaiImages} 張{s.openai.monthlyCap !== null && <span className="font-normal text-muted-foreground"> ／ {s.openai.monthlyCap}</span>}
            </p>
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          參考價【示意】：第三方整理 1024×1024 一張，高品質約 US$0.13–0.21、標準約 US$0.03–0.05；附參考圖、較大尺寸會更高，以 OpenAI 官方價目為準。
        </p>
      </ProviderCard>

      <ProviderCard
        provider="claude"
        title="Claude（看圖驗收）"
        purpose="版本頁「3 驗收」按「請 Claude 檢查」，逐項對照檢查清單給建議，按一下就能採用。"
        placeholder="sk-ant-…"
        info={s.claude}
        admin={admin}
        getKeyHref="https://console.anthropic.com/"
        getKeyLabel="Anthropic Console → API Keys"
        onModel={(model) => patch({ claude: { model } })}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="細心程度">
            <select
              className={inputCls}
              disabled={!admin || !!busy}
              value={s.claude.extra.effort}
              onChange={(e) => patch({ claude: { effort: e.target.value as ClaudeEffort } })}
            >
              <option value="medium">標準（較快、較省）</option>
              <option value="high">仔細（建議）</option>
              <option value="xhigh">最仔細（較慢、較貴）</option>
            </select>
          </Field>
          <CapField value={s.claude.monthlyCap} unit="次" disabled={!admin || !!busy} onChange={(monthlyCap) => patch({ claude: { monthlyCap } })} />
          <Field label="本月已用（全公司）">
            <p className="py-1.5 text-sm font-semibold">
              {s.usage.claudeReviews} 次
              {CLAUDE_PRICE[s.claude.model] && (
                <span className="block text-[11px] font-normal text-muted-foreground">
                  單價 輸入 US${CLAUDE_PRICE[s.claude.model].input}／輸出 US${CLAUDE_PRICE[s.claude.model].output} 每百萬 token
                </span>
              )}
            </p>
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          每次檢查約送 2 張 2048 寬的圖：Opus 5.5 約 US$0.05–0.15、Sonnet 5.5 約一半【示意：輸入約 8 千 token、輸出 2–5 千 token】。實際費用在檢查結果下方顯示。
        </p>
      </ProviderCard>

      <UsageByUser s={s} />

      <RoomsEditor rooms={s.rooms} admin={admin} />
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}

function CapField({ value, unit, disabled, onChange }: { value: number | null; unit: string; disabled: boolean; onChange: (v: number | null) => void }) {
  return (
    <Field label="全公司每月上限">
      <select
        className={inputCls}
        disabled={disabled}
        value={value === null ? "none" : String(value)}
        onChange={(e) => onChange(e.target.value === "none" ? null : Number(e.target.value))}
      >
        {CAP_OPTIONS.map((c) => (
          <option key={String(c)} value={c === null ? "none" : String(c)}>
            {c === null ? "不限制" : `${c} ${unit}`}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ProviderCard(p: {
  provider: "openai" | "claude";
  title: string;
  purpose: string;
  placeholder: string;
  info: PublicProvider<unknown>;
  admin: boolean;
  getKeyHref: string;
  getKeyLabel: string;
  onModel: (id: string) => void;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const { busy, run } = useBusy(toast);
  const [draft, setDraft] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const stored = p.info.source === "stored";
  const showInput = p.admin && (!stored || editing);

  const test = (key?: string) =>
    run("test", async () => {
      setStatus(null);
      try {
        const found = await saveProviderKey(p.provider, key);
        setDraft("");
        setEditing(false);
        setStatus({ ok: true, text: `連線成功，找到 ${found} 個可用模型；金鑰已加密存到後台。` });
      } catch (e) {
        setStatus({ ok: false, text: (e as Error).message });
      }
    });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      {toast.node}
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{p.title}</h2>
          <p className="text-xs text-muted-foreground">{p.purpose}</p>
        </div>
        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", p.info.configured ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
          {p.info.source === "stored" ? "已設定" : p.info.source === "env" ? "已設定（Vercel）" : "未設定"}
        </span>
      </div>

      {stored && !editing && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">••••{p.info.last4}</span>
          <span className="text-[11px] text-muted-foreground">
            {p.info.setBy} 於 {fmtTime(p.info.setAt)} 設定
          </span>
          {p.admin && (
            <>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => test()}>
                {busy === "test" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} 重新測試
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                更換金鑰
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:bg-danger/10"
                disabled={!!busy}
                onClick={() => {
                  if (confirm("從後台清除此金鑰？清除後全公司都無法使用這個功能，直到重新輸入。")) {
                    run("clear", async () => {
                      await clearProviderKey(p.provider);
                      setStatus(null);
                    });
                  }
                }}
              >
                <Trash2 /> 清除
              </Button>
            </>
          )}
        </div>
      )}
      {p.info.source === "env" && !editing && (
        <p className="text-[11px] text-muted-foreground">目前使用 Vercel 環境變數的金鑰。管理者在下方輸入後，會改用後台金鑰。</p>
      )}

      {showInput && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) test(draft.trim());
          }}
        >
          <label className="block space-y-1 text-xs font-medium">
            API 金鑰（輸入一次即可）
            <input
              className={cn(inputCls, "font-mono")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={p.placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!draft.trim() || !!busy}>
              {busy === "test" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} 測試並儲存到後台
            </Button>
            {editing && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                取消
              </Button>
            )}
            <a className="text-[11px] text-muted-foreground underline" href={p.getKeyHref} target="_blank" rel="noreferrer">
              去哪裡拿金鑰：{p.getKeyLabel}
            </a>
          </div>
        </form>
      )}
      {!p.admin && !p.info.configured && <p className="text-[11px] text-muted-foreground">尚未設定，請管理者輸入金鑰。</p>}

      {status && (
        <p className={cn("flex items-start gap-1.5 text-xs", status.ok ? "text-success" : "text-danger")}>
          {status.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {status.text}
        </p>
      )}

      {p.info.configured && (
        <>
          <Field label="使用模型">
            <select className={inputCls} value={p.info.model} disabled={!p.admin || !p.info.models.length} onChange={(e) => p.onModel(e.target.value)}>
              {!p.info.models.length && <option value={p.info.model}>{p.info.model || "請先按「重新測試」載入模型"}</option>}
              {p.info.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.note ? `｜${m.note}` : ""}
                </option>
              ))}
            </select>
          </Field>
          {p.children}
        </>
      )}
    </section>
  );
}

function UsageByUser({ s }: { s: PublicSettings }) {
  const rows = Object.entries(s.usage.byUser);
  if (!rows.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">本月用量（{s.usage.month}）</h2>
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">使用者</th>
            <th className="py-1 text-right font-medium">AI 出圖</th>
            <th className="py-1 text-right font-medium">Claude 驗收</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([email, u]) => (
            <tr key={email} className="border-t border-border">
              <td className="py-1">{email}</td>
              <td className="py-1 text-right">{u.openaiImages} 張</td>
              <td className="py-1 text-right">{u.claudeReviews} 次</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RoomsEditor({ rooms, admin }: { rooms: RoomPreset[]; admin: boolean }) {
  const toast = useToast();
  const { busy, run } = useBusy(toast);
  const [draft, setDraft] = React.useState<RoomPreset[]>(rooms);
  React.useEffect(() => setDraft(rooms), [rooms]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rooms);
  const upd = (i: number, r: Partial<RoomPreset>) => setDraft(draft.map((x, k) => (k === i ? { ...x, ...r } : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      {toast.node}
      <div>
        <h2 className="text-sm font-semibold">空間與圖號預設</h2>
        <p className="text-xs text-muted-foreground">
          新增視角時的「空間」選單照這個順序列出。有填起始圖號的空間，圖號留空時會從這個號碼往上自動找空號；沒填的接在專案目前最大號之後。
        </p>
      </div>
      <div className="space-y-1.5">
        <div className="grid grid-cols-[1fr_7rem_auto] gap-2 px-1 text-[11px] font-medium text-muted-foreground">
          <span>空間名稱</span>
          <span>起始圖號</span>
          <span />
        </div>
        {draft.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
            <input className={inputCls} disabled={!admin} value={r.name} maxLength={20} onChange={(e) => upd(i, { name: e.target.value })} />
            <input
              className={inputCls}
              disabled={!admin}
              inputMode="numeric"
              placeholder="不指定"
              value={r.startNo ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                upd(i, { startNo: v === "" ? null : Number(v) });
              }}
            />
            {admin ? (
              <div className="flex">
                <button aria-label="上移" className="rounded p-1 hover:bg-accent" onClick={() => move(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button aria-label="下移" className="rounded p-1 hover:bg-accent" onClick={() => move(i, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button aria-label="刪除空間" className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger" onClick={() => setDraft(draft.filter((_, k) => k !== i))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {admin && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setDraft([...draft, { name: "", startNo: null }])}>
            <Plus /> 新增空間
          </Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("恢復為系統預設的空間與圖號？（按儲存後才生效）") && setDraft(DEFAULT_ROOMS)}>
            <RotateCcw /> 恢復預設
          </Button>
          <Button size="sm" className="ml-auto" disabled={!dirty || !!busy} onClick={() => run("rooms", async () => {
            await patchCompany({ rooms: draft.map((r) => ({ name: r.name.trim(), startNo: r.startNo })) });
            toast.ok("已儲存空間與圖號預設");
          })}>
            {busy === "rooms" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} 儲存
          </Button>
        </div>
      )}
    </section>
  );
}
