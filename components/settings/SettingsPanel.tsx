"use client";

import * as React from "react";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { inputCls, useBusy, useToast } from "@/components/render/primitives";
import { fetchLiveStatus, listOpenAIImageModels, type LiveStatus, type ModelOption } from "@/lib/render/provider";
import { CLAUDE_PRICE, listClaudeModels } from "@/lib/render/claude";
import {
  maskKey,
  updateSettings,
  useDeviceSettings,
  useDeviceUsage,
  type ClaudeEffort,
  type OpenAIQuality,
} from "@/lib/render/settings";

const CAP_OPTIONS: (number | null)[] = [10, 20, 50, 100, 200, null];

export function SettingsPanel() {
  const s = useDeviceSettings();
  const usage = useDeviceUsage();
  const [server, setServer] = React.useState<LiveStatus | null>(null);
  React.useEffect(() => {
    fetchLiveStatus().then(setServer);
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">填入 API 金鑰後，工作台可以直接出圖（OpenAI）和看圖驗收（Claude），不用再手動往返 ChatGPT。</p>
      </div>

      <div className="flex gap-3 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed">
        <ShieldCheck className="h-5 w-5 shrink-0 text-success" />
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          <li>
            金鑰<strong className="text-foreground">只存在這台裝置的瀏覽器</strong>，不會上傳到璞石伺服器，也不會出現在專案備份或交付包裡；電腦、iPad 要各自輸入一次。
          </li>
          <li>出圖與驗收時，瀏覽器直接把圖片送到 OpenAI／Anthropic，費用記在你的帳戶。</li>
          <li>共用電腦用完請按「清除」。也請在 OpenAI、Anthropic 後台各設一個每月花費上限，這是真正擋得住的上限。</li>
        </ul>
      </div>

      <ProviderCard
        title="OpenAI（AI 出圖）"
        purpose="版本頁「2 生成」選「OpenAI API」即可直接出圖、自動匯入。"
        placeholder="sk-…"
        savedKey={s.openai.key}
        models={s.openai.models}
        model={s.openai.model}
        getKeyHref="https://platform.openai.com/api-keys"
        getKeyLabel="OpenAI 後台 → API keys"
        onTest={listOpenAIImageModels}
        onSaved={(key, models, model) =>
          updateSettings((x) => {
            x.openai.key = key;
            x.openai.models = models;
            x.openai.model = model;
          })
        }
        onModel={(id) => updateSettings((x) => void (x.openai.model = id))}
        onClear={() =>
          updateSettings((x) => {
            x.openai.key = "";
            x.openai.models = [];
            x.openai.model = "";
          })
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="預設品質">
            <select
              className={inputCls}
              value={s.openai.quality}
              onChange={(e) => updateSettings((x) => void (x.openai.quality = e.target.value as OpenAIQuality))}
            >
              <option value="high">高品質（建議，較貴）</option>
              <option value="medium">標準（約 1/4 價格）</option>
            </select>
          </Field>
          <Field label="本裝置每月上限">
            <select
              className={inputCls}
              value={s.openai.monthlyCap === null ? "none" : String(s.openai.monthlyCap)}
              onChange={(e) => updateSettings((x) => void (x.openai.monthlyCap = e.target.value === "none" ? null : Number(e.target.value)))}
            >
              {CAP_OPTIONS.map((c) => (
                <option key={String(c)} value={c === null ? "none" : String(c)}>
                  {c === null ? "不限制" : `${c} 張`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="本月已用（本裝置）">
            <p className="py-1.5 text-sm font-semibold">
              {usage.openaiImages} 張{s.openai.monthlyCap !== null && <span className="font-normal text-muted-foreground"> ／ {s.openai.monthlyCap}</span>}
            </p>
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          參考價【示意】：第三方整理 1024×1024 一張，高品質約 US$0.13–0.21、標準約 US$0.03–0.05；附參考圖、較大尺寸會更高，以 OpenAI 官方價目為準。
        </p>
      </ProviderCard>

      <ProviderCard
        title="Claude（看圖驗收）"
        purpose="版本頁「3 驗收」按「請 Claude 檢查」，逐項對照檢查清單給建議，你按一下就能採用。"
        placeholder="sk-ant-…"
        savedKey={s.claude.key}
        models={s.claude.models}
        model={s.claude.model}
        getKeyHref="https://console.anthropic.com/"
        getKeyLabel="Anthropic Console → API Keys"
        onTest={listClaudeModels}
        onSaved={(key, models, model) =>
          updateSettings((x) => {
            x.claude.key = key;
            x.claude.models = models;
            x.claude.model = model;
          })
        }
        onModel={(id) => updateSettings((x) => void (x.claude.model = id))}
        onClear={() =>
          updateSettings((x) => {
            x.claude.key = "";
            x.claude.models = [];
            x.claude.model = "";
          })
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="細心程度">
            <select
              className={inputCls}
              value={s.claude.effort}
              onChange={(e) => updateSettings((x) => void (x.claude.effort = e.target.value as ClaudeEffort))}
            >
              <option value="medium">標準（較快、較省）</option>
              <option value="high">仔細（建議）</option>
              <option value="xhigh">最仔細（較慢、較貴）</option>
            </select>
          </Field>
          <Field label="本月已用（本裝置）">
            <p className="py-1.5 text-sm font-semibold">{usage.claudeReviews} 次</p>
          </Field>
          <Field label="模型單價（每百萬 token）">
            <p className="py-1.5 text-xs text-muted-foreground">
              {CLAUDE_PRICE[s.claude.model]
                ? `輸入 US$${CLAUDE_PRICE[s.claude.model].input}／輸出 US$${CLAUDE_PRICE[s.claude.model].output}`
                : "—"}
            </p>
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          每次檢查約送 2 張 2048 寬的圖：Opus 5.5 約 US$0.05–0.15、Sonnet 5.5 約一半【示意：輸入約 8 千 token、輸出 2–5 千 token】。實際費用在檢查結果下方顯示。
        </p>
      </ProviderCard>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">公司共用金鑰（伺服器）</h2>
        <p className="text-xs text-muted-foreground">
          {server === null
            ? "檢查中…"
            : server.live
              ? `伺服器已設定 OpenAI 金鑰（模型 ${server.model}）。本裝置沒填金鑰時，出圖會改用這把。`
              : "伺服器未開啟共用金鑰。這是選用的：本裝置填了金鑰就能用；要讓所有設計師共用一把，需在 Vercel 設定環境變數（見 docs/SETTINGS-GUIDE.md）。"}
        </p>
      </section>
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

function ProviderCard(p: {
  title: string;
  purpose: string;
  placeholder: string;
  savedKey: string;
  models: ModelOption[];
  model: string;
  getKeyHref: string;
  getKeyLabel: string;
  onTest: (key: string) => Promise<ModelOption[]>;
  onSaved: (key: string, models: ModelOption[], model: string) => void;
  onModel: (id: string) => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const { busy, run } = useBusy(toast);
  const [draft, setDraft] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const showInput = !p.savedKey || editing;

  const test = (key: string) =>
    run("test", async () => {
      setStatus(null);
      try {
        const models = await p.onTest(key);
        const keep = models.some((m) => m.id === p.model) ? p.model : (models.find((m) => m.recommended) ?? models[0]).id;
        p.onSaved(key, models, keep);
        setDraft("");
        setEditing(false);
        setStatus({ ok: true, text: `連線成功，找到 ${models.length} 個可用模型。` });
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
        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", p.savedKey ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
          {p.savedKey ? "已設定" : "未設定"}
        </span>
      </div>

      {showInput ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) test(draft.trim());
          }}
        >
          <label className="block space-y-1 text-xs font-medium">
            API 金鑰
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
              {busy === "test" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} 測試並儲存
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
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{maskKey(p.savedKey)}</span>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => test(p.savedKey)}>
            {busy === "test" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} 重新測試
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            更換金鑰
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:bg-danger/10"
            onClick={() => {
              if (confirm("從這台裝置清除此金鑰？")) {
                p.onClear();
                setStatus(null);
              }
            }}
          >
            <Trash2 /> 清除
          </Button>
        </div>
      )}

      {status && (
        <p className={cn("flex items-start gap-1.5 text-xs", status.ok ? "text-success" : "text-danger")}>
          {status.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {status.text}
        </p>
      )}

      {p.savedKey && (
        <>
          <Field label="使用模型">
            <select className={inputCls} value={p.model} onChange={(e) => p.onModel(e.target.value)} disabled={!p.models.length}>
              {!p.models.length && <option value="">請先按「重新測試」載入模型</option>}
              {p.models.map((m) => (
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
