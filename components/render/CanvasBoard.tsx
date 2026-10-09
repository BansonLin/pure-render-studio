"use client";

import * as React from "react";
import { Crown, ImagePlus, Maximize2, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRenderStore } from "@/store/render-store";
import { addProjectReference, setOriginal } from "@/lib/render/actions";
import { REFERENCE_ROLE_LABEL } from "@/lib/render/types";
import type { ReferenceRole, RenderProject, RenderView, Version } from "@/lib/render/types";
import { versionsOf } from "@/lib/render/workflow";
import { AssetImg, FileButton, Pill, StateBadge } from "./primitives";

const THUMB_W = 224;
const THUMB_H = 126;
const LANE_HEADER_W = 200;
const GAP = 28;

export interface CanvasHandlers {
  onOpenVersion: (versionId: string) => void;
  onNewVersion: (viewId: string) => void;
  onOpenOriginal: (viewId: string) => void;
  onAddView: () => void;
  onError: (msg: string) => void;
}

interface Cam {
  x: number;
  y: number;
  k: number;
}

export function CanvasBoard({ project, h }: { project: RenderProject; h: CanvasHandlers }) {
  const mutate = useRenderStore((s) => s.mutate);
  const wrap = React.useRef<HTMLDivElement>(null);
  const [cam, setCam] = React.useState<Cam>({ x: 24, y: 16, k: 0.85 });
  const pan = React.useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [dragLane, setDragLane] = React.useState<{
    id: string;
    sx: number;
    sy: number;
    px: number;
    py: number;
    x: number;
    y: number;
  } | null>(null);

  const lanePos = (v: RenderView) =>
    dragLane && dragLane.id === v.id ? { x: dragLane.x, y: dragLane.y } : v.canvas;

  const fit = React.useCallback(() => {
    const el = wrap.current;
    if (!el || !project.views.length) return;
    const xs = project.views.map((v) => v.canvas.x);
    const ys = project.views.map((v) => v.canvas.y);
    const maxLen = Math.max(1, ...project.views.map((v) => versionsOf(project, v.id).length + 1));
    const minX = Math.min(...xs, project.referenceBoard.x) - 110;
    const minY = Math.min(...ys, project.referenceBoard.y);
    const maxX = Math.max(...xs.map((x) => x + LANE_HEADER_W + maxLen * (THUMB_W + GAP) + 80), project.referenceBoard.x + 520);
    const maxY = Math.max(...ys) + 300;
    const k = Math.min(1.1, Math.max(0.25, Math.min(el.clientWidth / (maxX - minX + 60), el.clientHeight / (maxY - minY + 60))));
    setCam({ k, x: -minX * k + 24, y: -minY * k + 16 });
  }, [project]);

  React.useEffect(() => {
    fit();
    // 只在換專案時自動置中
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const onWheel = (e: React.WheelEvent) => {
    const el = wrap.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const k2 = Math.min(2, Math.max(0.2, cam.k * Math.exp(-e.deltaY * 0.0025)));
      setCam({ k: k2, x: mx - ((mx - cam.x) * k2) / cam.k, y: my - ((my - cam.y) * k2) / cam.k });
    } else {
      setCam((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
    }
  };

  // 觸控板 pinch 在 Chrome/Safari 以 ctrl+wheel 送出；需非被動監聽才能阻止瀏覽器縮放
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const stop = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-nopan]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragLane) {
      setDragLane({
        ...dragLane,
        x: dragLane.px + (e.clientX - dragLane.sx) / cam.k,
        y: dragLane.py + (e.clientY - dragLane.sy) / cam.k,
      });
      return;
    }
    if (!pan.current) return;
    setCam((c) => ({ ...c, x: pan.current!.cx + e.clientX - pan.current!.x, y: pan.current!.cy + e.clientY - pan.current!.y }));
  };
  const onPointerUp = () => {
    pan.current = null;
    if (dragLane) {
      const { id, x, y } = dragLane;
      setDragLane(null);
      mutate(project.id, (d) => {
        if (id === "__refs__") d.referenceBoard = { x: Math.round(x), y: Math.round(y) };
        const v = d.views.find((vv) => vv.id === id);
        if (v) v.canvas = { x: Math.round(x), y: Math.round(y) };
      });
    }
  };

  const startLaneDrag = (id: string, pos: { x: number; y: number }) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,input,select,textarea")) return;
    e.stopPropagation();
    wrap.current?.setPointerCapture(e.pointerId);
    setDragLane({ id, sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y, x: pos.x, y: pos.y });
  };

  // 主圖 → 衍生的依賴線
  const edges: { from: RenderView; to: RenderView }[] = [];
  for (const v of project.views)
    for (const mid of v.dependsOn) {
      const m = project.views.find((x) => x.id === mid);
      if (m) edges.push({ from: m, to: v });
    }

  const refs = project.references;
  const refPos = dragLane?.id === "__refs__" ? { x: dragLane.x, y: dragLane.y } : project.referenceBoard;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle,hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]">
      <div
        ref={wrap}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.k})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {edges.map(({ from, to }, i) => {
              const a = lanePos(from);
              const b = lanePos(to);
              // 依賴線畫在標頭左側，每條錯開，避免重疊
              const x1 = a.x;
              const y1 = a.y + 28;
              const x2 = b.x;
              const y2 = b.y + 28;
              const bend = 36 + i * 16;
              const accepted = !!from.acceptedVersionId;
              const color = accepted ? "hsl(var(--success))" : "hsl(var(--muted-foreground))";
              return (
                <g key={`${from.id}-${to.id}`} opacity={0.6}>
                  <path
                    d={`M${x1},${y1} C${x1 - bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={accepted ? undefined : "6 6"}
                  />
                  <circle cx={x2} cy={y2} r={4} fill={color} />
                  <text x={x1 - bend + 4} y={(y1 + y2) / 2} fontSize={11} fill={color} transform={`rotate(-90 ${x1 - bend + 4} ${(y1 + y2) / 2})`} textAnchor="middle">
                    {from.id}→{to.id}
                  </text>
                </g>
              );
            })}
          </svg>

          {project.views.map((v) => (
            <ViewLane
              key={v.id}
              project={project}
              view={v}
              pos={lanePos(v)}
              onDragStart={startLaneDrag(v.id, lanePos(v))}
              h={h}
            />
          ))}

          {/* 參考圖板 */}
          <div
            data-nopan
            className="absolute w-[500px] rounded-xl border border-border bg-card/95 shadow-sm"
            style={{ left: refPos.x, top: refPos.y }}
          >
            <div
              className="flex cursor-move items-center gap-2 border-b border-border px-3 py-2"
              onPointerDown={startLaneDrag("__refs__", refPos)}
            >
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold">設計參考圖板</span>
              <span className="text-[10px] text-muted-foreground">材質／燈具／櫃體照片，只借造型不借空間</span>
              <FileButton
                multiple
                className="ml-auto rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
                onFiles={async (files) => {
                  for (const f of files) {
                    try {
                      await addProjectReference(project.id, f);
                    } catch (e) {
                      h.onError((e as Error).message);
                    }
                  }
                }}
              >
                ＋ 加入
              </FileButton>
            </div>
            <DropZone
              className="grid min-h-[120px] grid-cols-3 gap-2 p-3"
              onFiles={async (files) => {
                for (const f of files) {
                  try {
                    await addProjectReference(project.id, f);
                  } catch (e) {
                    h.onError((e as Error).message);
                  }
                }
              }}
            >
              {refs.length === 0 && (
                <p className="col-span-3 self-center text-center text-xs text-muted-foreground">拖入參考照片（例：餐邊櫃、吊燈）</p>
              )}
              {refs.map((r, i) => (
                <div key={r.assetId} className="space-y-1">
                  <AssetImg id={r.assetId} alt={r.label} className="aspect-square w-full rounded-md object-cover" />
                  <input
                    className="w-full rounded border border-transparent bg-transparent px-1 text-[11px] hover:border-border"
                    value={r.label}
                    onChange={(e) =>
                      mutate(project.id, (d) => {
                        d.references[i].label = e.target.value;
                      })
                    }
                  />
                  <select
                    className="w-full rounded border border-border bg-card px-1 text-[10px]"
                    value={r.role}
                    onChange={(e) =>
                      mutate(project.id, (d) => {
                        d.references[i].role = e.target.value as ReferenceRole;
                      })
                    }
                  >
                    {(["object", "material", "style"] as ReferenceRole[]).map((role) => (
                      <option key={role} value={role}>
                        {REFERENCE_ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </DropZone>
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm">
        <button aria-label="縮小" className="rounded p-1.5 hover:bg-accent" onClick={() => setCam((c) => ({ ...c, k: Math.max(0.2, c.k / 1.2) }))}>
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(cam.k * 100)}%</span>
        <button aria-label="放大" className="rounded p-1.5 hover:bg-accent" onClick={() => setCam((c) => ({ ...c, k: Math.min(2, c.k * 1.2) }))}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button aria-label="全部置中" className="rounded p-1.5 hover:bg-accent" onClick={fit}>
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent" onClick={h.onAddView}>
          <Plus className="h-3.5 w-3.5" /> 新增視角
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-3 right-3 hidden rounded-md bg-card/80 px-2 py-1 text-[10px] text-muted-foreground sm:block">
        拖曳空白處平移 · 觸控板捏合或 ⌘／Ctrl＋滾輪縮放 · 拖曳視角標頭可重新排列
      </p>
    </div>
  );
}

function DropZone({
  children,
  className,
  onFiles,
}: {
  children: React.ReactNode;
  className?: string;
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = React.useState(false);
  return (
    <div
      className={cn(className, over && "outline-dashed outline-2 -outline-offset-4 outline-foreground/40")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
        if (files.length) onFiles(files);
      }}
    >
      {children}
    </div>
  );
}

function ViewLane({
  project,
  view,
  pos,
  onDragStart,
  h,
}: {
  project: RenderProject;
  view: RenderView;
  pos: { x: number; y: number };
  onDragStart: (e: React.PointerEvent) => void;
  h: CanvasHandlers;
}) {
  const versions = versionsOf(project, view.id);
  const masters = view.dependsOn.map((id) => project.views.find((v) => v.id === id)).filter(Boolean) as RenderView[];
  const mastersReady = masters.every((m) => m.acceptedVersionId);
  return (
    <div className="absolute" style={{ left: pos.x, top: pos.y }} data-nopan>
      <div className="flex items-start gap-[28px]">
        {/* 標頭 */}
        <div className="w-[200px] shrink-0 cursor-move rounded-xl border border-border bg-card p-3 shadow-sm" onPointerDown={onDragStart}>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-xs font-bold text-background">{view.id}</span>
            <span className="truncate text-sm font-semibold">{view.name}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Pill tone={view.role === "master" ? "ok" : "muted"}>{view.role === "master" ? "主圖" : view.role === "derived" ? "衍生" : "獨立"}</Pill>
            <Pill>{view.room}</Pill>
            {view.acceptedVersionId && (
              <Pill tone="ok">
                <Crown className="h-3 w-3" /> {project.versions.find((x) => x.id === view.acceptedVersionId)?.label}
              </Pill>
            )}
          </div>
          {masters.length > 0 && (
            <p className={cn("mt-2 text-[11px]", mastersReady ? "text-success" : "text-warning")}>
              依賴主圖 {masters.map((m) => m.id).join("、")}：{mastersReady ? "已核准" : "待核准"}
            </p>
          )}
          {view.notes && <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{view.notes}</p>}
          <button
            className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md bg-foreground py-1.5 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-40"
            disabled={!view.originalAssetId}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => h.onNewVersion(view.id)}
          >
            <Plus className="h-3.5 w-3.5" /> 新版本
          </button>
        </div>

        {/* 原圖 */}
        <OriginalSlot project={project} view={view} h={h} />

        {/* 版本鏈 */}
        {versions.map((v) => (
          <VersionThumb key={v.id} v={v} accepted={view.acceptedVersionId === v.id} onOpen={() => h.onOpenVersion(v.id)} />
        ))}
      </div>
    </div>
  );
}

function OriginalSlot({ project, view, h }: { project: RenderProject; view: RenderView; h: CanvasHandlers }) {
  const meta = useRenderStore((s) => (view.originalAssetId ? s.assets[view.originalAssetId] : null));
  if (!view.originalAssetId) {
    return (
      <DropZone
        className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/70 p-3 text-center"
        onFiles={async ([f]) => {
          try {
            await setOriginal(project.id, view.id, f);
          } catch (e) {
            h.onError((e as Error).message);
          }
        }}
      >
        <div style={{ width: THUMB_W, height: THUMB_H }} className="flex flex-col items-center justify-center gap-2">
          <ImagePlus className="h-6 w-6 text-muted-foreground" />
          <p className="text-xs font-medium">拖入 3D 原圖</p>
          <FileButton
            className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
            onFiles={async ([f]) => {
              try {
                await setOriginal(project.id, view.id, f);
              } catch (e) {
                h.onError((e as Error).message);
              }
            }}
          >
            選擇檔案
          </FileButton>
        </div>
      </DropZone>
    );
  }
  return (
    <button className="group shrink-0 text-left" onClick={() => h.onOpenOriginal(view.id)}>
      <div className="overflow-hidden rounded-xl border-2 border-foreground/70 bg-card shadow-sm">
        <AssetImg id={view.originalAssetId} alt={`視角 ${view.id} 原圖`} className="object-cover" style={{ width: THUMB_W, height: THUMB_H }} />
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <span className="text-[11px] font-semibold">3D 原圖</span>
          <Pill>唯讀</Pill>
          {meta && (
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {meta.width}×{meta.height}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function VersionThumb({ v, accepted, onOpen }: { v: Version; accepted: boolean; onOpen: () => void }) {
  const ripple = v.qa?.ripple;
  return (
    <button className="group relative shrink-0 text-left" onClick={onOpen}>
      <span className="absolute -left-[22px] top-[58px] text-muted-foreground/60">→</span>
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow group-hover:shadow-md",
          accepted ? "border-success ring-2 ring-success/30" : "border-border",
        )}
      >
        {v.resultAssetId ? (
          <AssetImg id={v.resultAssetId} alt={`${v.viewId} ${v.label}`} className="object-cover" style={{ width: THUMB_W, height: THUMB_H }} />
        ) : (
          <div style={{ width: THUMB_W, height: THUMB_H }} className="relative">
            <AssetImg id={v.baseAssetId} alt="底圖" className="h-full w-full object-cover opacity-30 grayscale" />
            <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground">
              {v.state === "draft" ? "編輯指令中" : "等待 AI 結果"}
            </span>
          </div>
        )}
        <div className="space-y-1 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold">{v.label}</span>
            <StateBadge state={v.state} />
            {accepted && <Crown className="h-3.5 w-3.5 text-success" />}
          </div>
          <div className="flex flex-wrap gap-1">
            <Pill title="底圖策略">{v.baseStrategy === "original" ? "原圖單跳" : v.baseStrategy === "accepted" ? "從核准版" : "從前版"}</Pill>
            {v.regions.length > 0 && <Pill>{v.regions.length} 區</Pill>}
            <Pill tone={v.generationDepth >= 2 ? "warn" : "muted"} title="世代深度：未回貼的全圖重生成次數">
              G{v.generationDepth}
            </Pill>
            {ripple && (
              <Pill tone={ripple.suspectRatio > 0.02 || ripple.cornerMax > 0.6 ? "warn" : "ok"} title="水波紋疑似面積">
                紋 {(ripple.suspectRatio * 100).toFixed(1)}%
              </Pill>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
