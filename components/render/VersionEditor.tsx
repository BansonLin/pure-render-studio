"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown,
  Brush,
  Check,
  Copy,
  Crop,
  Download,
  Eye,
  Loader2,
  Lock,
  MousePointer2,
  Package,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAssetUrl, useRenderStore } from "@/store/render-store";
import {
  acceptVersion,
  baseAssetFor,
  compileVersion,
  createDraft,
  cropToObject,
  exportManualPackage,
  importResult,
  patchVersion,
  referenceLabels,
  runApiGeneration,
  setState,
} from "@/lib/render/actions";
import { preflight, shapeBounds, describeArea } from "@/lib/render/compiler";
import { BLOCK_CATEGORY_LABEL, PROMPT_BLOCKS, type BlockCategory } from "@/lib/render/prompt-blocks";
import { fetchLiveStatus, PROVIDER_CAPS, type LiveStatus } from "@/lib/render/provider";
import { rememberApprover, useDeviceSettings, useDeviceUsage } from "@/lib/render/settings";
import { estimateCost, runClaudeReview } from "@/lib/render/claude";
import { REFERENCE_ROLE_LABEL } from "@/lib/render/types";
import type { BaseStrategy, QaVerdict, ReferenceRole, Region, RenderProject, Version } from "@/lib/render/types";
import { repairsUsed, STATE_LABEL } from "@/lib/render/workflow";
import { AnnotationStage, type StageMode, type Tool } from "./AnnotationStage";
import { AssetImg, inputCls, Modal, Pill, Segmented, StateBadge, useBusy, useToast } from "./primitives";

type Tab = "prompt" | "run" | "qa";

export function VersionEditor({
  project,
  versionId,
  onClose,
  onSwitch,
}: {
  project: RenderProject;
  versionId: string;
  onClose: () => void;
  onSwitch: (versionId: string) => void;
}) {
  const v = project.versions.find((x) => x.id === versionId);
  const assets = useRenderStore((s) => s.assets);
  const toast = useToast();
  const { busy, run } = useBusy(toast);
  const [tab, setTab] = React.useState<Tab>(v && v.state !== "draft" ? (v.resultAssetId ? "qa" : "run") : "prompt");
  const [tool, setTool] = React.useState<Tool>("select");
  const [mode, setMode] = React.useState<StageMode>(v?.resultAssetId ? "compare" : "base");
  const [zoom, setZoom] = React.useState<"fit" | "full">("fit");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [brush, setBrush] = React.useState(0.02);
  const [showHeat, setShowHeat] = React.useState(true);
  // null = 自動：沒有修改區（全圖）時附上場景規格；只修局部時不附，避免模型順手改擺件
  const [contractPref, setIncludeContract] = React.useState<boolean | null>(null);
  const [annotation, setAnnotation] = React.useState(true);
  const [importOpts, setImportOpts] = React.useState({ align: true, composite: true, feather: 0.006 });
  const [live, setLive] = React.useState<LiveStatus | null>(null);

  React.useEffect(() => {
    fetchLiveStatus().then(setLive);
  }, []);

  const view = project.views.find((x) => x.id === v?.viewId);
  const urls = {
    base: useAssetUrl(v?.baseAssetId),
    result: useAssetUrl(v?.resultAssetId),
    original: useAssetUrl(view?.originalAssetId),
  };
  if (!v || !view) return null;
  const baseMeta = assets[v.baseAssetId];
  const aspect = baseMeta ? baseMeta.width / baseMeta.height : 16 / 9;
  const editable = v.state === "draft";
  const patch = (fn: (x: Version) => void) => patchVersion(project.id, v.id, fn);

  const masters = view.dependsOn.map((id) => {
    const m = project.views.find((x) => x.id === id);
    return { viewId: id, accepted: !!m?.acceptedVersionId };
  });
  const risks = preflight({
    view,
    hasOriginal: !!view.originalAssetId,
    baseStrategy: v.baseStrategy,
    generationDepth: v.generationDepth,
    editRegionCount: v.regions.filter((r) => r.kind !== "lock").length,
    references: v.references,
    masters,
    repairsUsed: repairsUsed(project, view.id),
    repairLimit: project.repairLimit,
    maxReferences: PROVIDER_CAPS.manual.maxReferences,
  });
  const includeContract = contractPref ?? !v.regions.some((r) => r.kind === "edit");
  const compiled = compileVersion(project, v, assets, { includeSceneContract: includeContract, maskSupported: false, annotation });

  const ripple = v.qa?.ripple ?? null;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="rounded bg-foreground px-1.5 py-0.5 font-mono text-xs text-background">{view.id}</span>
          {view.name} · {v.label}
          <StateBadge state={v.state} />
          <Pill title="世代深度">G{v.generationDepth}</Pill>
        </span>
      }
    >
      {toast.node}
      <div className="flex h-full min-h-[70vh] flex-col lg:flex-row">
        {/* 舞台 */}
        <div className="flex min-h-[50vh] min-w-0 flex-1 flex-col border-b border-border bg-muted/40 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
            <Segmented<StageMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "base", label: "底圖" },
                ...(v.resultAssetId
                  ? ([
                      { value: "result", label: "AI 結果" },
                      { value: "compare", label: "對比" },
                    ] as { value: StageMode; label: string }[])
                  : []),
                ...(view.originalAssetId && v.baseAssetId !== view.originalAssetId
                  ? ([{ value: "original", label: "3D 原圖" }] as { value: StageMode; label: string }[])
                  : []),
              ]}
            />
            <Segmented<"fit" | "full">
              value={zoom}
              onChange={setZoom}
              options={[
                { value: "fit", label: "符合" },
                { value: "full", label: "100%", title: "原尺寸檢視：角落與布面紋理請在此判斷" },
              ]}
            />
            {ripple && (
              <label className="inline-flex items-center gap-1 text-xs">
                <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} /> 紋理熱圖
              </label>
            )}
            {editable && (
              <div className="ml-auto flex items-center gap-1">
                <ToolBtn active={tool === "select"} onClick={() => setTool("select")} icon={MousePointer2} label="選取" />
                <ToolBtn active={tool === "edit"} onClick={() => setTool("edit")} icon={Square} label="修改區" color="text-rose-600" />
                <ToolBtn active={tool === "brush"} onClick={() => setTool("brush")} icon={Brush} label="筆刷" color="text-rose-600" />
                <ToolBtn active={tool === "object"} onClick={() => setTool("object")} icon={Target} label="物件" color="text-amber-600" />
                <ToolBtn active={tool === "lock"} onClick={() => setTool("lock")} icon={Lock} label="鎖定" color="text-blue-600" />
                {tool === "brush" && (
                  <input
                    aria-label="筆刷大小"
                    type="range"
                    min={0.005}
                    max={0.06}
                    step={0.0025}
                    value={brush}
                    onChange={(e) => setBrush(Number(e.target.value))}
                    className="w-20"
                  />
                )}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <AnnotationStage
              urls={urls}
              naturalWidth={baseMeta?.width ?? 1600}
              aspect={aspect}
              mode={mode}
              zoom={zoom}
              regions={v.regions}
              selectedId={selected}
              onSelect={setSelected}
              editable={editable}
              tool={tool}
              brushRadius={brush}
              onCreate={(r) => {
                patch((x) => {
                  x.regions.push(r);
                });
                setSelected(r.id);
              }}
              onBrush={(id, shape) =>
                patch((x) => {
                  const r = x.regions.find((rr) => rr.id === id);
                  if (r) r.shape = shape;
                })
              }
              heat={showHeat && ripple ? ripple.grid : null}
              findings={showHeat && ripple ? ripple.findings : []}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>
              底圖：{v.baseStrategy === "original" ? "3D 原圖（單跳）" : v.baseStrategy === "accepted" ? "已核准版本" : "前一版"}
              {baseMeta && ` · ${baseMeta.width}×${baseMeta.height}`}
            </span>
            <span className="font-mono">sha {baseMeta?.sha256.slice(0, 10)}…</span>
            {editable && <span>框選後在右側寫這一區要改什麼；鎖定區（藍）一定不會被改動。</span>}
          </div>
        </div>

        {/* 右側面板 */}
        <div className="flex w-full shrink-0 flex-col lg:w-[440px]">
          <div className="flex border-b border-border">
            {(
              [
                ["prompt", "1 指令"],
                ["run", "2 生成"],
                ["qa", "3 驗收"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  "flex-1 border-b-2 py-2.5 text-xs font-semibold",
                  tab === k ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {tab === "prompt" && (
              <PromptTab
                project={project}
                v={v}
                editable={editable}
                selected={selected}
                setSelected={setSelected}
                patch={patch}
                compiled={compiled}
                risks={risks}
                includeContract={includeContract}
                setIncludeContract={setIncludeContract}
                annotation={annotation}
                setAnnotation={setAnnotation}
                onCopy={() => {
                  navigator.clipboard.writeText(compiled.prompt).then(() => toast.ok("已複製提示詞"));
                }}
                onCrop={(regionId, objectId) =>
                  run("crop", async () => {
                    await cropToObject(project.id, v.id, regionId, objectId);
                    toast.ok("已存為物件參考，衍生視角可直接引用");
                  })
                }
              />
            )}
            {tab === "run" && (
              <RunTab
                v={v}
                busy={busy}
                live={live}
                risks={risks}
                importOpts={importOpts}
                setImportOpts={setImportOpts}
                onExport={() =>
                  run("export", async () => {
                    await exportManualPackage(project.id, v.id, { includeSceneContract: includeContract, annotation });
                    toast.ok("已下載任務包；在 ChatGPT 完成後回來匯入結果");
                  })
                }
                onImport={(file) =>
                  run("import", async () => {
                    const notes = await importResult(project.id, v.id, file, importOpts);
                    setMode("compare");
                    setTab("qa");
                    toast.ok(notes.find((n) => n.includes("構圖")) ?? notes[0] ?? "已匯入並完成自動檢查");
                  })
                }
                onApi={(quality) =>
                  run("api", async () => {
                    await runApiGeneration(project.id, v.id, { ...importOpts, includeSceneContract: includeContract, quality });
                    setMode("compare");
                    setTab("qa");
                    toast.ok("AI 結果已回傳並完成自動檢查");
                  })
                }
                onMarkFailed={() => run("fail", () => setState(project.id, v.id, "failed", "使用者確認供應商無結果"))}
                onReopen={() => run("reopen", () => setState(project.id, v.id, "draft", "回到編輯（尚未匯入結果）"))}
              />
            )}
            {tab === "qa" && (
              <QaTab
                project={project}
                v={v}
                busy={busy}
                patch={patch}
                onState={(s, d) => run("state", () => setState(project.id, v.id, s, d))}
                onAccept={(by, note) =>
                  run("accept", async () => {
                    const n = await acceptVersion(project.id, v.id, by, note);
                    toast.ok(n ? `已核准；${n} 個衍生版本標記為需重驗` : "已核准");
                  })
                }
                onRepair={() =>
                  run("repair", async () => {
                    const id = await createDraft(project.id, v.viewId, "parent", v.id);
                    onSwitch(id);
                  })
                }
                onClaude={() =>
                  run("claude", async () => {
                    const review = await runClaudeReview(project, v);
                    await patch((x) => {
                      if (!x.qa) return;
                      x.qa.aiReview = review;
                      x.events.push({ at: review.at, type: "ai_review", detail: `${review.model}：${review.issues.length} 項問題` });
                    });
                    toast.ok(review.issues.length ? `Claude 找到 ${review.issues.length} 項問題，請逐項確認` : "Claude 沒有發現明顯問題，仍請人工確認");
                  })
                }
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ToolBtn({
  active,
  onClick,
  icon: Icon,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
        active ? "bg-foreground text-background" : "hover:bg-accent",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", !active && color)} />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function Section({ title, hint, children, right }: { title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h4 className="text-xs font-semibold">{title}</h4>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        <div className="ml-auto">{right}</div>
      </div>
      {children}
    </section>
  );
}

// ---------------- 1. 指令 ----------------

function PromptTab({
  project,
  v,
  editable,
  selected,
  setSelected,
  patch,
  compiled,
  risks,
  includeContract,
  setIncludeContract,
  annotation,
  setAnnotation,
  onCopy,
  onCrop,
}: {
  project: RenderProject;
  v: Version;
  editable: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  patch: (fn: (x: Version) => void) => Promise<void>;
  compiled: { prompt: string; summaryZh: string[] };
  risks: ReturnType<typeof preflight>;
  includeContract: boolean;
  setIncludeContract: (b: boolean) => void;
  annotation: boolean;
  setAnnotation: (b: boolean) => void;
  onCopy: () => void;
  onCrop: (regionId: string, objectId: string) => void;
}) {
  const assets = useRenderStore((s) => s.assets);
  const labels = referenceLabels(project, assets);
  const [showPrompt, setShowPrompt] = React.useState(false);
  const categories = Object.keys(BLOCK_CATEGORY_LABEL) as BlockCategory[];

  const strategies: { value: BaseStrategy; label: string; ok: boolean }[] = [
    { value: "original", label: "從 3D 原圖單跳（建議）", ok: !!baseAssetFor(project, v.viewId, "original", null) },
    { value: "accepted", label: "從已核准版本修正", ok: !!baseAssetFor(project, v.viewId, "accepted", null) },
    { value: "parent", label: "從前一版修正", ok: !!v.parentVersionId },
  ];

  // 可加入的參考圖來源
  const candidates: { assetId: string; role: ReferenceRole; note: string; source: "pinned-master" | "scene-object" | "manual"; label: string }[] = [];
  const view = project.views.find((x) => x.id === v.viewId)!;
  for (const mv of project.views) {
    if (mv.id === v.viewId || !mv.acceptedVersionId) continue;
    const acc = project.versions.find((x) => x.id === mv.acceptedVersionId);
    if (acc?.resultAssetId)
      candidates.push({
        assetId: acc.resultAssetId,
        role: "master-view",
        note: "",
        source: view.dependsOn.includes(mv.id) ? "pinned-master" : "manual",
        label: `核准圖 ${mv.id} ${mv.name}`,
      });
  }
  for (const o of project.sceneObjects)
    if (o.referenceAssetId)
      candidates.push({ assetId: o.referenceAssetId, role: "object", note: o.name, source: "scene-object", label: `物件：${o.name}` });
  for (const r of project.references) candidates.push({ assetId: r.assetId, role: r.role, note: "", source: "manual", label: r.label });
  const available = candidates.filter((c) => !v.references.some((r) => r.assetId === c.assetId));

  return (
    <>
      {risks.length > 0 && (
        <div className="space-y-1.5">
          {risks.map((r, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed",
                r.level === "error" ? "bg-danger/10 text-danger" : r.level === "warn" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
              )}
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {r.text}
            </div>
          ))}
        </div>
      )}

      <Section title="底圖策略" hint="決定 AI 從哪張圖開始改">
        <select
          className={inputCls}
          disabled={!editable}
          value={v.baseStrategy}
          onChange={(e) => {
            const s = e.target.value as BaseStrategy;
            const base = baseAssetFor(project, v.viewId, s, v.parentVersionId);
            if (!base) return;
            patch((x) => {
              x.baseStrategy = s;
              x.baseAssetId = base;
            });
          }}
        >
          {strategies.map((s) => (
            <option key={s.value} value={s.value} disabled={!s.ok}>
              {s.label}
              {!s.ok ? "（無可用底圖）" : ""}
            </option>
          ))}
        </select>
      </Section>

      <Section title="本輪需求原文" hint="照你的話寫，系統不改寫">
        <textarea
          className={cn(inputCls, "min-h-[72px]")}
          disabled={!editable}
          placeholder="例：電視牆弧形跟沙發背牆用特殊塗料提升質感；角落還看得到水波紋，全部清掉。"
          value={v.rawRequest}
          onChange={(e) => patch((x) => void (x.rawRequest = e.target.value))}
        />
      </Section>

      <Section title={`畫布標註（${v.regions.length}）`} hint="E 修改／O 物件／L 鎖定">
        {v.regions.length === 0 && (
          <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
            沒有標註 = 全圖修改。修正版本建議一定要框選：只改框內，框外會回貼原像素。
          </p>
        )}
        <div className="space-y-2">
          {v.regions.map((r, i) => (
            <RegionCard
              key={r.id}
              project={project}
              r={r}
              index={v.regions.filter((x, j) => x.kind === r.kind && j <= i).length}
              selected={selected === r.id}
              editable={editable}
              hasResult={!!v.resultAssetId}
              onSelect={() => setSelected(r.id)}
              onChange={(fn) =>
                patch((x) => {
                  const rr = x.regions.find((q) => q.id === r.id);
                  if (rr) fn(rr);
                })
              }
              onDelete={() => patch((x) => void (x.regions = x.regions.filter((q) => q.id !== r.id)))}
              onCrop={onCrop}
            />
          ))}
        </div>
      </Section>

      <Section title="提示詞積木" hint="全圖套用；選區積木請在標註卡片內勾">
        <div className="space-y-2.5">
          {categories.map((cat) => (
            <div key={cat}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{BLOCK_CATEGORY_LABEL[cat]}</p>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_BLOCKS.filter((b) => b.category === cat).map((b) => {
                  const on = v.blockIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      disabled={!editable}
                      title={b.hint}
                      onClick={() =>
                        patch((x) => {
                          x.blockIds = on ? x.blockIds.filter((id) => id !== b.id) : [...x.blockIds, b.id];
                        })
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60",
                        on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-accent",
                      )}
                    >
                      {on && <Check className="-ml-0.5 mr-0.5 inline h-3 w-3" />}
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`參考圖（${v.references.length}）`} hint="第 1 張永遠是底圖，以下依序為 Image 2、3…">
        <div className="space-y-2">
          {v.references.map((r, i) => (
            <div key={r.assetId} className="flex gap-2 rounded-lg border border-border p-2">
              <AssetImg id={r.assetId} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground">Image {i + 2}</span>
                  <span className="truncate text-xs font-medium">{labels[r.assetId] ?? "參考圖"}</span>
                </div>
                <div className="flex gap-1">
                  <select
                    className="rounded border border-border bg-card px-1 text-[11px]"
                    disabled={!editable}
                    value={r.role}
                    onChange={(e) => patch((x) => void (x.references[i].role = e.target.value as ReferenceRole))}
                  >
                    {(["master-view", "object", "material", "style"] as ReferenceRole[]).map((role) => (
                      <option key={role} value={role}>
                        {REFERENCE_ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 text-[11px]"
                    disabled={!editable}
                    placeholder="只借什麼？例：餐邊櫃、吊燈"
                    value={r.note}
                    onChange={(e) => patch((x) => void (x.references[i].note = e.target.value))}
                  />
                </div>
              </div>
              {editable && (
                <div className="flex flex-col gap-1">
                  {i > 0 && (
                    <button
                      aria-label="上移"
                      className="rounded p-1 hover:bg-accent"
                      onClick={() =>
                        patch((x) => {
                          const [it] = x.references.splice(i, 1);
                          x.references.splice(i - 1, 0, it);
                        })
                      }
                    >
                      <ArrowDown className="h-3 w-3 rotate-180" />
                    </button>
                  )}
                  <button aria-label="移除" className="rounded p-1 hover:bg-danger/10 hover:text-danger" onClick={() => patch((x) => void x.references.splice(i, 1))}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {editable && available.length > 0 && (
            <select
              className={inputCls}
              value=""
              onChange={(e) => {
                const c = available.find((a) => a.assetId === e.target.value);
                if (c) patch((x) => void x.references.push({ assetId: c.assetId, role: c.role, note: c.note, source: c.source }));
              }}
            >
              <option value="">＋ 加入參考圖…</option>
              {available.map((c) => (
                <option key={c.assetId} value={c.assetId}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </Section>

      <Section title="編譯選項">
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={includeContract} onChange={(e) => setIncludeContract(e.target.checked)} />
          <span>
            附上本視角可見的場景物件規格（數量、錨點）
            <span className="block text-[11px] text-muted-foreground">全圖首輪建議開；只修局部材質時可關，減少模型亂動擺件。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={annotation} onChange={(e) => setAnnotation(e.target.checked)} />
          <span>
            任務包附「標註示意圖」
            <span className="block text-[11px] text-muted-foreground">幫 ChatGPT 看懂框選位置；提示詞已註明不得畫出框線。</span>
          </span>
        </label>
      </Section>

      <Section
        title="編譯結果"
        right={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setShowPrompt((s) => !s)}>
              <Eye /> {showPrompt ? "收合" : "完整提示詞"}
            </Button>
            <Button size="sm" variant="outline" onClick={onCopy}>
              <Copy /> 複製
            </Button>
          </div>
        }
      >
        <ul className="space-y-1 rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
          {compiled.summaryZh.map((s, i) => (
            <li key={i}>· {s}</li>
          ))}
        </ul>
        {showPrompt && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-3 font-mono text-[10.5px] leading-relaxed">
            {compiled.prompt}
          </pre>
        )}
      </Section>
    </>
  );
}

function RegionCard({
  project,
  r,
  index,
  selected,
  editable,
  hasResult,
  onSelect,
  onChange,
  onDelete,
  onCrop,
}: {
  project: RenderProject;
  r: Region;
  index: number;
  selected: boolean;
  editable: boolean;
  hasResult: boolean;
  onSelect: () => void;
  onChange: (fn: (r: Region) => void) => void;
  onDelete: () => void;
  onCrop: (regionId: string, objectId: string) => void;
}) {
  const tag = `${r.kind === "edit" ? "E" : r.kind === "lock" ? "L" : "O"}${index}`;
  const color = r.kind === "edit" ? "bg-rose-600" : r.kind === "lock" ? "bg-blue-600" : "bg-amber-600";
  const regional = PROMPT_BLOCKS.filter((b) => b.regional);
  const where = describeArea(shapeBounds(r.shape)).zh;
  return (
    <div
      onClick={onSelect}
      className={cn("space-y-2 rounded-lg border p-2.5", selected ? "border-foreground shadow-sm" : "border-border")}
    >
      <div className="flex items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white", color)}>{tag}</span>
        <input
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs font-medium hover:border-border focus:border-border"
          placeholder={r.kind === "lock" ? `鎖定：${where}` : r.kind === "object" ? `物件位置：${where}` : `修改：${where}`}
          disabled={!editable}
          value={r.label}
          onChange={(e) => onChange((x) => void (x.label = e.target.value))}
        />
        {editable && (
          <button aria-label="刪除標註" className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {r.kind !== "lock" && (
        <textarea
          className={cn(inputCls, "min-h-[52px] text-xs")}
          disabled={!editable}
          placeholder={r.kind === "object" ? "補充：例：花瓶靠餐廚端，與主圖同款" : "這一區要改成什麼？例：地毯換成完全素面的沙米色氈，只留大範圍光影"}
          value={r.instruction}
          onChange={(e) => onChange((x) => void (x.instruction = e.target.value))}
        />
      )}
      {r.kind === "object" && (
        <div className="flex gap-1.5">
          <select
            className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-1 text-[11px]"
            disabled={!editable}
            value={r.objectId ?? ""}
            onChange={(e) => onChange((x) => void (x.objectId = e.target.value || null))}
          >
            <option value="">連結場景物件…</option>
            {project.sceneObjects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {r.objectId && hasResult && (
            <button
              className="inline-flex items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-accent"
              title="從此版本結果裁出，存為物件參考圖"
              onClick={(e) => {
                e.stopPropagation();
                onCrop(r.id, r.objectId!);
              }}
            >
              <Crop className="h-3 w-3" /> 存為參考
            </button>
          )}
        </div>
      )}
      {r.kind === "edit" && (
        <div className="flex flex-wrap gap-1">
          {regional.map((b) => {
            const on = r.blockIds.includes(b.id);
            return (
              <button
                key={b.id}
                disabled={!editable}
                title={b.hint}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange((x) => void (x.blockIds = on ? x.blockIds.filter((id) => id !== b.id) : [...x.blockIds, b.id]));
                }}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] disabled:opacity-60",
                  on ? "border-rose-600 bg-rose-600 text-white" : "border-border hover:bg-accent",
                )}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- 2. 生成 ----------------

function RunTab({
  v,
  busy,
  live,
  risks,
  importOpts,
  setImportOpts,
  onExport,
  onImport,
  onApi,
  onMarkFailed,
  onReopen,
}: {
  v: Version;
  busy: string | null;
  live: LiveStatus | null;
  risks: ReturnType<typeof preflight>;
  importOpts: { align: boolean; composite: boolean; feather: number };
  setImportOpts: (o: { align: boolean; composite: boolean; feather: number }) => void;
  onExport: () => void;
  onImport: (f: File) => void;
  onApi: (q: "medium" | "high") => void;
  onMarkFailed: () => void;
  onReopen: () => void;
}) {
  const device = useDeviceSettings();
  const usage = useDeviceUsage();
  const deviceReady = !!(device.openai.key && device.openai.model);
  // 有設定金鑰就預設走 API，省掉 ChatGPT 往返；沒有就維持手動
  const [provider, setProvider] = React.useState<"manual" | "openai">(deviceReady ? "openai" : "manual");
  const [consent, setConsent] = React.useState(false);
  const [quality, setQuality] = React.useState<"medium" | "high">(device.openai.quality);
  const capLeft = device.openai.monthlyCap === null ? null : device.openai.monthlyCap - usage.openaiImages;
  const apiReady = deviceReady || !!live?.live;
  const blocked = risks.some((r) => r.level === "error");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const hasRegions = v.regions.some((r) => r.kind !== "lock");
  const canRun = v.state === "draft" || v.state === "submitted" || v.state === "failed";

  return (
    <>
      {v.state === "outcome_unknown" && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
          <p className="font-semibold">結果未知：供應商可能已處理並計費。</p>
          <p>請先到供應商後台確認，不要直接重送。若取得結果，用下方「匯入 AI 結果」；確認沒有結果再標記失敗。</p>
          <Button size="sm" variant="outline" onClick={onMarkFailed}>
            確認無結果，標記失敗
          </Button>
        </div>
      )}

      <Section title="生成方式">
        <Segmented<"manual" | "openai">
          value={provider}
          onChange={setProvider}
          options={[
            { value: "manual", label: PROVIDER_CAPS.manual.label },
            { value: "openai", label: PROVIDER_CAPS.openai.label },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">{PROVIDER_CAPS[provider].note}</p>
      </Section>

      {provider === "manual" ? (
        <Section title="ChatGPT 手動流程" hint="零 API 成本">
          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            <li>下載任務包（底圖、參考圖已依序編號，附提示詞與說明）。</li>
            <li>每個版本開一個新的 ChatGPT 對話，依編號上傳、貼上提示詞。</li>
            <li>下載結果原檔，回到這裡匯入。不要在同一對話裡連修第二、三次。</li>
          </ol>
          <Button className="w-full" disabled={!!busy || blocked || !canRun} onClick={onExport}>
            {busy === "export" ? <Loader2 className="animate-spin" /> : <Package />} 下載 ChatGPT 任務包
          </Button>
          {blocked && <p className="text-[11px] text-danger">有阻擋項未解決（見「指令」頁上方紅字）。</p>}
          {v.state === "submitted" && !v.resultAssetId && (
            <button className="text-[11px] text-muted-foreground underline" onClick={onReopen}>
              匯出後發現要改指令？回到編輯
            </button>
          )}
        </Section>
      ) : (
        <Section title="API 生成">
          {!apiReady ? (
            <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
              還沒有可用的 OpenAI 金鑰。到右上角
              <Link href="/settings" className="mx-1 font-medium text-foreground underline">
                設定
              </Link>
              填入金鑰即可直接出圖。
            </p>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">
                模型：{deviceReady ? `${device.openai.model}（本裝置設定）` : `${live?.model}（伺服器共用金鑰）`}
                {capLeft !== null && `｜本月本裝置剩 ${Math.max(0, capLeft)} 張`}
              </p>
              <Segmented<"medium" | "high">
                value={quality}
                onChange={setQuality}
                options={[
                  { value: "medium", label: "標準" },
                  { value: "high", label: "高品質" },
                ]}
              />
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                我有權使用這些圖片，同意將底圖、遮罩與參考圖傳送至 OpenAI 進行付費處理（1 張、不自動重試）。
              </label>
              <Button className="w-full" disabled={!consent || !!busy || blocked || !canRun || (capLeft !== null && capLeft <= 0)} onClick={() => onApi(quality)}>
                {busy === "api" ? <Loader2 className="animate-spin" /> : <Send />} 送出生成
              </Button>
            </>
          )}
        </Section>
      )}

      <Section title="匯入 AI 結果" hint="自動校正與回貼">
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={importOpts.align} onChange={(e) => setImportOpts({ ...importOpts, align: e.target.checked })} />
          <span>
            鏡位自動校正
            <span className="block text-[11px] text-muted-foreground">AI 常偷偷縮放或位移構圖（一樓 34 視角實測放大約 5%）；匯入時對回底圖。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={!hasRegions && !v.regions.length}
            checked={importOpts.composite && v.regions.length > 0}
            onChange={(e) => setImportOpts({ ...importOpts, composite: e.target.checked })}
          />
          <span>
            選區外回貼底圖像素
            <span className="block text-[11px] text-muted-foreground">
              {v.regions.length ? "只保留框內的 AI 修改，框外維持底圖——水波紋不會擴散到其他區域。" : "此版本沒有標註，全圖採用 AI 結果。"}
            </span>
          </span>
        </label>
        {importOpts.composite && v.regions.length > 0 && (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            接縫羽化
            <input
              type="range"
              min={0.002}
              max={0.02}
              step={0.001}
              value={importOpts.feather}
              onChange={(e) => setImportOpts({ ...importOpts, feather: Number(e.target.value) })}
            />
            {(importOpts.feather * 100).toFixed(1)}%
          </label>
        )}
        <Button variant="outline" className="w-full" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === "import" ? <Loader2 className="animate-spin" /> : <Upload />} 匯入 AI 結果
        </Button>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onImport(f);
          }}
        />
        {v.resultAssetId && <p className="text-[11px] text-muted-foreground">已有結果；再次匯入會覆蓋此版本的候選圖（原始檔仍保留在歷程）。</p>}
      </Section>

      <Section title="歷程">
        <ol className="space-y-1 text-[11px] text-muted-foreground">
          {[...v.events].reverse().map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums">{new Date(e.at).toLocaleString("zh-TW", { hour12: false })}</span>
              <span className="font-medium text-foreground">{STATE_LABEL[e.type as Version["state"]] ?? e.type}</span>
              <span className="min-w-0 break-words">{e.detail}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

// ---------------- 3. 驗收 ----------------

function QaTab({
  project,
  v,
  busy,
  patch,
  onState,
  onAccept,
  onRepair,
  onClaude,
}: {
  project: RenderProject;
  v: Version;
  busy: string | null;
  patch: (fn: (x: Version) => void) => Promise<void>;
  onState: (s: Version["state"], detail?: string) => void;
  onAccept: (by: string, note: string) => void;
  onRepair: () => void;
  onClaude: () => void;
}) {
  const device = useDeviceSettings();
  const [by, setBy] = React.useState(device.approvers[0] ?? "");
  const [note, setNote] = React.useState("");
  const rawUrl = useAssetUrl(v.rawResultAssetId);
  if (!v.qa) {
    return <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">尚未匯入 AI 結果。</p>;
  }
  const r = v.qa.ripple;
  const a = v.qa.alignment;
  const view = project.views.find((x) => x.id === v.viewId)!;
  const isCurrentAccepted = view.acceptedVersionId === v.id;
  const failCount = v.qa.checks.filter((c) => c.verdict === "fail").length;
  const unchecked = v.qa.checks.filter((c) => c.verdict === null).length;

  return (
    <>
      {r && (
        <Section title="水波紋自動篩查" hint={r.comparedTo === "original" ? "對照 3D 原圖" : r.comparedTo === "base" ? "對照底圖" : "無對照"}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="疑似新增紋理" value={`${(r.suspectRatio * 100).toFixed(1)}%`} warn={r.suspectRatio > 0.02} />
            <Stat label="四角最高分" value={`${Math.round(r.cornerMax * 100)}`} warn={r.cornerMax > 0.6} />
          </div>
          {r.findings.length > 0 ? (
            <ul className="space-y-1 text-[11px]">
              {r.findings.slice(0, 6).map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yellow-400" />
                  {f.where}（強度 {Math.round(f.score * 100)}）
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">未標出疑似區。</p>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            篩查只找「比原圖多出來的細紋」。窗簾褶、百葉光影等刻意設計也可能被標出；沒標出也不等於零瑕疵——請用 100% 檢視四角與布面。
          </p>
        </Section>
      )}

      {(() => {
        const imp = [...v.events].reverse().find((e) => e.type === "imported");
        return imp?.detail ? (
          <Section title="匯入處理紀錄">
            <p className="rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">{imp.detail}</p>
          </Section>
        ) : null;
      })()}

      {a && (
        <Section title="鏡位校正">
          <p className="text-[11px] text-muted-foreground">
            縮放 {((1 / a.scale - 1) * 100).toFixed(1)}%、位移 {Math.round(a.dx)}, {Math.round(a.dy)} px · 結構相似度 {(a.similarity * 100).toFixed(0)}%
          </p>
          {a.similarity < 0.45 && <p className="text-[11px] text-warning">相似度偏低：AI 可能改了鏡位或家具輪廓，請對照 3D 原圖確認。</p>}
          {rawUrl && (
            <a href={rawUrl} download className="inline-flex items-center gap-1 text-[11px] underline">
              <Download className="h-3 w-3" /> 下載 AI 原始輸出（未校正）
            </a>
          )}
        </Section>
      )}

      <ClaudeSection v={v} busy={busy} claudeReady={!!(device.claude.key && device.claude.model)} model={device.claude.model} onRun={onClaude} onAdoptAll={() =>
        patch((x) => {
          for (const s of x.qa?.aiReview?.checks ?? []) {
            const c = x.qa!.checks.find((cc) => cc.id === s.id);
            if (c && c.verdict === null) {
              c.verdict = s.verdict;
              if (s.verdict !== "pass") c.note = `Claude：${s.reason}`;
            }
          }
        })
      } />

      <Section title="人工檢查清單" hint={`${v.qa.checks.length - unchecked}/${v.qa.checks.length} 已判定`}>
        <div className="space-y-2">
          {v.qa.checks.map((c, i) => (
            <div key={c.id} className="space-y-1 rounded-md border border-border p-2">
              <p className="text-xs">{c.label}</p>
              <AiHint
                suggestion={v.qa?.aiReview?.checks.find((s) => s.id === c.id)}
                adopted={c.verdict !== null}
                onAdopt={(s) =>
                  patch((x) => {
                    x.qa!.checks[i].verdict = s.verdict;
                    x.qa!.checks[i].note = s.verdict === "pass" ? x.qa!.checks[i].note : `Claude：${s.reason}`;
                  })
                }
              />
              <div className="flex gap-1">
                {(
                  [
                    ["pass", "通過", "bg-success text-success-foreground"],
                    ["fail", "待修", "bg-danger text-danger-foreground"],
                    ["uncertain", "不確定", "bg-warning text-warning-foreground"],
                    ["na", "不適用", "bg-muted-foreground text-background"],
                  ] as [QaVerdict, string, string][]
                ).map(([val, label, cls]) => (
                  <button
                    key={val}
                    onClick={() => patch((x) => void (x.qa!.checks[i].verdict = c.verdict === val ? null : val))}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px]",
                      c.verdict === val ? cls : "border border-border hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(c.verdict === "fail" || c.verdict === "uncertain") && (
                <IssueNote value={c.note} onChange={(n) => patch((x) => void (x.qa!.checks[i].note = n))} />
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="決定">
        {v.acceptance ? (
          <div className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
            已由 {v.acceptance.by} 於 {new Date(v.acceptance.at).toLocaleString("zh-TW", { hour12: false })} 核准
            {v.acceptance.note && `：${v.acceptance.note}`}
            {!isCurrentAccepted && "（已被較新版本取代）"}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy || !["qa_pending", "human_review_pending", "needs_revalidation"].includes(v.state)}
            onClick={() => onState("repair_needed", v.qa?.checks.filter((c) => c.verdict === "fail").map((c) => c.note || c.label).join("；"))}
          >
            標記待修正
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy || !["qa_pending", "repair_needed", "needs_revalidation"].includes(v.state)}
            onClick={() => onState("human_review_pending")}
          >
            送主管核准
          </Button>
        </div>
        {(v.state === "repair_needed" || failCount > 0) && (
          <Button size="sm" className="w-full" disabled={!!busy} onClick={onRepair}>
            開修正版本（框選問題區域）
          </Button>
        )}
        {repairsUsed(project, v.viewId) >= project.repairLimit && (
          <p className="text-[11px] text-warning">
            已達修正上限 {project.repairLimit} 次。建議停下來判斷：回原圖重建、人工修圖，或調整需求範圍。
          </p>
        )}
        {v.state === "human_review_pending" && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-semibold">人工核准</p>
            <input className={inputCls} list="approver-options" placeholder="核准者（可選或輸入）" value={by} onChange={(e) => setBy(e.target.value)} />
            <datalist id="approver-options">
              {device.approvers.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <select className={inputCls} value={ACCEPT_NOTES.includes(note) ? note : note ? "__custom" : ""} onChange={(e) => setNote(e.target.value === "__custom" ? " " : e.target.value)}>
              <option value="">核准說明（選填）</option>
              {ACCEPT_NOTES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value="__custom">其他（自行輸入）</option>
            </select>
            {note && !ACCEPT_NOTES.includes(note) && (
              <input className={inputCls} autoFocus placeholder="自行輸入說明" value={note.trimStart()} onChange={(e) => setNote(e.target.value || " ")} />
            )}
            {unchecked > 0 && <p className="text-[11px] text-warning">仍有 {unchecked} 項未判定。</p>}
            <Button
              className="w-full"
              disabled={!by.trim() || !!busy}
              onClick={() => {
                rememberApprover(by);
                onAccept(by, note.trim());
              }}
            >
              <Check /> 核准此版本
            </Button>
          </div>
        )}
        {!["accepted", "rejected"].includes(v.state) && (
          <button className="text-[11px] text-muted-foreground underline" onClick={() => onState("rejected")}>
            退件（保留紀錄）
          </button>
        )}
      </Section>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2.5", warn ? "border-warning/40 bg-warning/5" : "border-border")}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", warn && "text-warning")}>{value}</p>
    </div>
  );
}


const ACCEPT_NOTES = ["四角已原尺寸檢查", "與主圖物件一致", "選區外已回貼原圖", "客戶已確認", "僅供內部示意"];

const ISSUE_PLACES = ["左上", "上方", "右上", "左側", "中央", "右側", "左下", "下方", "右下", "全圖"];
const ISSUE_PROBLEMS = [
  "布面／地毯有水波紋、迷宮紋",
  "角落或窄縫殘紋",
  "門窗位置或形狀改變",
  "牆線、櫃體分割跑掉",
  "構圖被縮放或位移",
  "物件數量不符",
  "物件被移動或變形",
  "多出原圖沒有的物件",
  "材質與指令不符",
  "嵌燈亮點光暈",
  "日光方向不對",
  "與主圖物件不一致",
];

/** 問題備註以「位置：問題」存成一段文字，舊資料的自由文字也照常顯示 */
function IssueNote({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = value.match(/^(左上|上方|右上|左側|中央|右側|左下|下方|右下|全圖)：([\s\S]*)$/);
  const place = m ? m[1] : "";
  const text = m ? m[2] : value;
  const join = (p: string, t: string) => (p ? `${p}：${t}` : t);
  return (
    <div className="flex gap-1">
      <select
        aria-label="問題位置"
        className="w-[4.5rem] shrink-0 rounded border border-border bg-card px-1 py-1 text-[11px]"
        value={place}
        onChange={(e) => onChange(join(e.target.value, text))}
      >
        <option value="">位置</option>
        {ISSUE_PLACES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input
        aria-label="問題"
        list="qa-problem-options"
        className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-1 text-[11px]"
        placeholder="選擇或輸入問題"
        value={text}
        onChange={(e) => onChange(join(place, e.target.value))}
      />
      <datalist id="qa-problem-options">
        {ISSUE_PROBLEMS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </div>
  );
}

const VERDICT_TEXT = { pass: "通過", fail: "待修", uncertain: "不確定" } as const;
const VERDICT_TONE = { pass: "text-success", fail: "text-danger", uncertain: "text-warning" } as const;

function AiHint({
  suggestion,
  adopted,
  onAdopt,
}: {
  suggestion: { verdict: "pass" | "fail" | "uncertain"; reason: string } | undefined;
  adopted: boolean;
  onAdopt: (s: { verdict: "pass" | "fail" | "uncertain"; reason: string }) => void;
}) {
  if (!suggestion) return null;
  return (
    <div className="flex items-start gap-1.5 rounded bg-muted/60 px-1.5 py-1 text-[11px]">
      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-muted-foreground">
        <span className={cn("font-semibold", VERDICT_TONE[suggestion.verdict])}>Claude 建議{VERDICT_TEXT[suggestion.verdict]}</span>
        ：{suggestion.reason}
      </p>
      {!adopted && (
        <button className="shrink-0 rounded border border-border px-1.5 hover:bg-accent" onClick={() => onAdopt(suggestion)}>
          採用
        </button>
      )}
    </div>
  );
}

const FOLLOWED_TEXT = { yes: "已照指令修改", partial: "部分照做", no: "沒有照指令", unclear: "無法判斷" } as const;
const SEVERITY = {
  high: ["嚴重", "bg-danger/15 text-danger"],
  medium: ["中等", "bg-warning/15 text-warning"],
  low: ["輕微", "bg-muted text-muted-foreground"],
} as const;

function ClaudeSection({
  v,
  busy,
  claudeReady,
  model,
  onRun,
  onAdoptAll,
}: {
  v: Version;
  busy: string | null;
  claudeReady: boolean;
  model: string;
  onRun: () => void;
  onAdoptAll: () => void;
}) {
  const r = v.qa?.aiReview ?? null;
  const cost = r ? estimateCost(r.model, r.usage) : null;
  return (
    <Section title="Claude 看圖驗收" hint="建議，最後仍由人判定">
      {!claudeReady ? (
        <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
          到右上角
          <Link href="/settings" className="mx-1 font-medium text-foreground underline">
            設定
          </Link>
          填入 Claude 金鑰，就能讓 Claude 對照底圖逐項檢查。
        </p>
      ) : (
        <>
          <Button size="sm" variant={r ? "outline" : "default"} className="w-full" disabled={!!busy} onClick={onRun}>
            {busy === "claude" ? <Loader2 className="animate-spin" /> : <Sparkles />} {r ? "重新請 Claude 檢查" : "請 Claude 檢查"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            模型 {model}｜會把底圖與結果圖送到 Anthropic；約需 30–90 秒。
          </p>
        </>
      )}
      {r && (
        <div className="space-y-2 rounded-lg border border-border p-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={r.instructionsFollowed === "yes" ? "ok" : r.instructionsFollowed === "unclear" ? "muted" : "warn"}>
              {FOLLOWED_TEXT[r.instructionsFollowed]}
            </Pill>
            <Pill tone={r.issues.some((i) => i.severity === "high") ? "bad" : r.issues.length ? "warn" : "ok"}>{r.issues.length} 項問題</Pill>
          </div>
          <p className="leading-relaxed">{r.summary}</p>
          {r.issues.length > 0 && (
            <ul className="space-y-1">
              {r.issues.map((i, k) => (
                <li key={k} className="flex items-start gap-1.5 text-[11px]">
                  <span className={cn("shrink-0 rounded px-1 font-semibold", SEVERITY[i.severity][1])}>{SEVERITY[i.severity][0]}</span>
                  <span className="shrink-0 font-medium">{i.location}</span>
                  <span className="text-muted-foreground">{i.problem}</span>
                </li>
              ))}
            </ul>
          )}
          {r.checks.length > 0 && (
            <Button size="sm" variant="outline" className="w-full" onClick={onAdoptAll}>
              把建議填進尚未判定的檢查項
            </Button>
          )}
          <p className="text-[10px] text-muted-foreground">
            {r.model}・{new Date(r.at).toLocaleString("zh-TW", { hour12: false })}
            {cost !== null && `・約 US$${cost.toFixed(3)}`}
          </p>
        </div>
      )}
    </Section>
  );
}
