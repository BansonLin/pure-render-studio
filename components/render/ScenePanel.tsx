"use client";

import * as React from "react";
import { ImagePlus, Lock, Plus, Trash2, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAssetUrl, useRenderStore } from "@/store/render-store";
import { addAssetFromFile } from "@/lib/render/actions";
import { shapeBounds } from "@/lib/render/compiler";
import { uid } from "@/lib/render/image";
import { SCENE_CATEGORY_LABEL } from "@/lib/render/types";
import type { RenderProject, SceneCategory, SceneObject, Visibility } from "@/lib/render/types";
import { AssetImg, FileButton, inputCls, Pill } from "./primitives";

const VIS_LABEL: Record<Visibility, string> = { visible: "可見", partial: "部分", hidden: "看不到", unknown: "未確認" };
const VIS_NEXT: Record<Visibility, Visibility> = { unknown: "visible", visible: "partial", partial: "hidden", hidden: "unknown" };
const VIS_CLS: Record<Visibility, string> = {
  visible: "bg-success/15 text-success",
  partial: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  hidden: "bg-muted text-muted-foreground line-through",
  unknown: "border border-dashed border-border text-muted-foreground",
};

export function ScenePanel({ project, onError }: { project: RenderProject; onError: (m: string) => void }) {
  const mutate = useRenderStore((s) => s.mutate);
  const [open, setOpen] = React.useState<string | null>(null);
  const upd = (id: string, fn: (o: SceneObject) => void) =>
    mutate(project.id, (d) => {
      const o = d.sceneObjects.find((x) => x.id === id);
      if (o) fn(o);
    });

  return (
    <main className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">場景物件聖經</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            「A 角度的花瓶到 B 角度變成另一個花瓶」的根因，是每張圖都靠文字重新想像物件。這裡把每個物件定成一份規格＋一張參考裁切圖，
            並記錄它在每個視角是否可見；編譯提示詞時自動帶入，看不到的物件會明確告訴 AI「不要加」。位置一律用空間錨點，不用畫面左右。
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            const id = uid("obj");
            mutate(project.id, (d) =>
              void d.sceneObjects.push({
                id,
                name: "新物件",
                category: "prop",
                spec: "",
                promptSpec: "",
                count: 1,
                anchor: "",
                referenceAssetId: null,
                views: Object.fromEntries(d.views.map((v) => [v.id, "unknown" as Visibility])),
                locked: false,
              }),
            );
            setOpen(id);
          }}
        >
          <Plus /> 新增物件
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="border-b border-border bg-muted/50 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">物件</th>
              <th className="px-2 py-2 text-left font-medium">數量</th>
              <th className="px-2 py-2 text-left font-medium">空間錨點</th>
              {project.views.map((v) => (
                <th key={v.id} className="px-2 py-2 text-center font-medium">
                  {v.id}
                </th>
              ))}
              <th className="px-2 py-2 text-left font-medium">參考圖</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {project.sceneObjects.map((o) => (
              <React.Fragment key={o.id}>
                <tr className={cn("border-b border-border/60 align-top hover:bg-muted/30", open === o.id && "bg-muted/30")}>
                  <td className="px-3 py-2">
                    <button className="text-left" onClick={() => setOpen(open === o.id ? null : o.id)}>
                      <span className="font-medium">{o.name}</span>
                      <Pill className="ml-1.5">{SCENE_CATEGORY_LABEL[o.category]}</Pill>
                      {o.locked && <Lock className="ml-1 inline h-3 w-3 text-muted-foreground" />}
                      <span className="mt-0.5 line-clamp-2 block max-w-[320px] text-[11px] text-muted-foreground">{o.spec}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{o.count ?? "—"}</td>
                  <td className="max-w-[180px] px-2 py-2 text-[11px] text-muted-foreground">{o.anchor}</td>
                  {project.views.map((v) => {
                    const vis = o.views[v.id] ?? "unknown";
                    return (
                      <td key={v.id} className="px-2 py-2 text-center">
                        <button
                          title="點擊切換：可見 → 部分 → 看不到 → 未確認"
                          className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", VIS_CLS[vis])}
                          onClick={() => upd(o.id, (x) => void (x.views[v.id] = VIS_NEXT[vis]))}
                        >
                          {VIS_LABEL[vis]}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">
                    {o.referenceAssetId ? (
                      <AssetImg id={o.referenceAssetId} alt={o.name} className="h-10 w-14 rounded object-cover" />
                    ) : (
                      <FileButton
                        className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                        onFiles={async ([f]) => {
                          try {
                            const m = await addAssetFromFile(project.id, f, "object-crop", `物件_${o.name}`);
                            upd(o.id, (x) => void (x.referenceAssetId = m.id));
                          } catch (e) {
                            onError((e as Error).message);
                          }
                        }}
                      >
                        <ImagePlus className="h-3 w-3" /> 上傳
                      </FileButton>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <button
                      aria-label="刪除物件"
                      className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                      onClick={() => confirm(`刪除「${o.name}」？`) && mutate(project.id, (d) => void (d.sceneObjects = d.sceneObjects.filter((x) => x.id !== o.id)))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
                {open === o.id && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={project.views.length + 5} className="px-3 py-3">
                      <ObjectEditor o={o} onChange={(fn) => upd(o.id, fn)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ConsistencyGrid project={project} />
    </main>
  );
}

function ObjectEditor({ o, onChange }: { o: SceneObject; onChange: (fn: (o: SceneObject) => void) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 space-y-1 text-[11px] font-medium">
            名稱
            <input className={inputCls} value={o.name} onChange={(e) => onChange((x) => void (x.name = e.target.value))} />
          </label>
          <label className="space-y-1 text-[11px] font-medium">
            類別
            <select className={inputCls} value={o.category} onChange={(e) => onChange((x) => void (x.category = e.target.value as SceneCategory))}>
              {Object.entries(SCENE_CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1 text-[11px] font-medium">
            全場景數量
            <input
              className={inputCls}
              type="number"
              min={0}
              value={o.count ?? ""}
              onChange={(e) => onChange((x) => void (x.count = e.target.value === "" ? null : Number(e.target.value)))}
            />
          </label>
          <label className="col-span-2 space-y-1 text-[11px] font-medium">
            空間錨點（不用畫面左右）
            <input className={inputCls} value={o.anchor} placeholder="例：茶几靠前窗端" onChange={(e) => onChange((x) => void (x.anchor = e.target.value))} />
          </label>
        </div>
        <label className="block space-y-1 text-[11px] font-medium">
          中文規格（給人看）
          <textarea className={cn(inputCls, "min-h-[80px] text-xs")} value={o.spec} onChange={(e) => onChange((x) => void (x.spec = e.target.value))} />
        </label>
      </div>
      <div className="space-y-2">
        <label className="block space-y-1 text-[11px] font-medium">
          給模型的規格（英文，寫進提示詞）
          <textarea
            className={cn(inputCls, "min-h-[150px] font-mono text-[11px]")}
            value={o.promptSpec}
            placeholder="Exactly ONE low round matte ivory vase with five olive branches at the DINING end of the coffee table…"
            onChange={(e) => onChange((x) => void (x.promptSpec = e.target.value))}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => onChange((x) => void (x.locked = !x.locked))}
          >
            {o.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            {o.locked ? "已定案（變更需主管同意）" : "提案中"}
          </button>
          {o.referenceAssetId && (
            <button className="text-[11px] text-muted-foreground underline" onClick={() => onChange((x) => void (x.referenceAssetId = null))}>
              移除參考圖
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 一致性對照：同一物件在各視角的「物件標註」裁切並排 */
function ConsistencyGrid({ project }: { project: RenderProject }) {
  const rows = project.sceneObjects
    .map((o) => {
      const cells = project.views.map((view) => {
        const candidates = project.versions
          .filter((v) => v.viewId === view.id && v.resultAssetId)
          .sort((a, b) => (a.id === view.acceptedVersionId ? -1 : b.id === view.acceptedVersionId ? 1 : b.createdAt.localeCompare(a.createdAt)));
        for (const v of candidates) {
          const r = v.regions.find((rr) => rr.kind === "object" && rr.objectId === o.id);
          if (r) return { view, version: v, bounds: shapeBounds(r.shape) };
        }
        return { view, version: null, bounds: null };
      });
      return { o, cells };
    })
    .filter((r) => r.cells.some((c) => c.version));

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">跨視角一致性對照</h3>
      <p className="text-[11px] text-muted-foreground">
        在任一版本用「物件」工具框選並連結場景物件，這裡就會並排各視角的同一物件（優先取核准版）。適合主管一眼檢查款式、數量與方位是否一致。
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">尚無物件標註。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-medium">物件</th>
                {project.views.map((v) => (
                  <th key={v.id} className="px-2 py-2 text-left font-medium">
                    {v.id} {v.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, cells }) => (
                <tr key={o.id} className="border-b border-border/60">
                  <td className="px-3 py-2 align-top font-medium">{o.name}</td>
                  {cells.map((c) => (
                    <td key={c.view.id} className="px-2 py-2 align-top">
                      {c.version && c.bounds ? (
                        <div className="space-y-1">
                          <Crop assetId={c.version.resultAssetId!} b={c.bounds} />
                          <span className="text-[10px] text-muted-foreground">{c.version.label}</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">{VIS_LABEL[o.views[c.view.id] ?? "unknown"]}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Crop({ assetId, b }: { assetId: string; b: { x: number; y: number; w: number; h: number } }) {
  const url = useAssetUrl(assetId);
  const W = 160;
  const H = Math.max(60, Math.min(160, (W * b.h * 9) / (b.w * 16)));
  if (!url) return <div className="bg-muted" style={{ width: W, height: H }} />;
  return (
    <div
      className="rounded border border-border"
      style={{
        width: W,
        height: H,
        backgroundImage: `url(${url})`,
        backgroundSize: `${100 / b.w}% ${100 / b.h}%`,
        backgroundPosition: `${b.w < 1 ? (b.x / (1 - b.w)) * 100 : 0}% ${b.h < 1 ? (b.y / (1 - b.h)) * 100 : 0}%`,
      }}
    />
  );
}
