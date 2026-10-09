"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Box, Globe, LayoutGrid, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRenderProject, useRenderStore } from "@/store/render-store";
import { addView, createDraft } from "@/lib/render/actions";
import type { ViewRole } from "@/lib/render/types";
import { CanvasBoard } from "./CanvasBoard";
import { VersionEditor } from "./VersionEditor";
import { ScenePanel } from "./ScenePanel";
import { PanoPanel } from "./PanoPanel";
import { DeliveryPanel } from "./DeliveryPanel";
import { AssetImg, ChoiceInput, inputCls, Modal, Pill, useBusy, useToast } from "./primitives";
import { ROOM_OPTIONS, SHOT_OPTIONS, STYLE_PRESETS } from "@/lib/render/options";
import { RenderBoot } from "./RenderBoot";

type WsTab = "canvas" | "scene" | "pano" | "delivery";

export function Workspace({ projectId }: { projectId: string }) {
  return (
    <RenderBoot>
      <WorkspaceInner projectId={projectId} />
    </RenderBoot>
  );
}

function WorkspaceInner({ projectId }: { projectId: string }) {
  const project = useRenderProject(projectId);
  const assets = useRenderStore((s) => s.assets);
  const mutate = useRenderStore((s) => s.mutate);
  const toast = useToast();
  const { busy, run } = useBusy(toast);
  const [tab, setTab] = React.useState<WsTab>("canvas");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [original, setOriginal] = React.useState<string | null>(null);
  const [newView, setNewView] = React.useState(false);
  const [nv, setNv] = React.useState({ id: "", name: "", room: "", role: "standalone" as ViewRole, dependsOn: [] as string[] });
  const [shot, setShot] = React.useState("");

  if (!project) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        找不到此專案（可能在另一台電腦或已刪除）。<Link className="underline" href="/">回專案列表</Link>
      </div>
    );
  }

  const newVersion = (viewId: string) =>
    run("new", async () => {
      const view = project.views.find((v) => v.id === viewId);
      const id = await createDraft(project.id, viewId, view?.acceptedVersionId ? "accepted" : "original");
      setEditing(id);
    });

  const origView = project.views.find((v) => v.id === original);
  const origMeta = origView?.originalAssetId ? assets[origView.originalAssetId] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toast.node}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> 專案
        </Link>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{project.code || "—"}</span>
        <input
          className="min-w-0 max-w-xs flex-1 rounded border border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border focus:border-border"
          value={project.name}
          onChange={(e) => mutate(project.id, (d) => void (d.name = e.target.value))}
          aria-label="專案名稱"
        />
        <div className="ml-auto flex rounded-lg border border-border bg-muted/50 p-0.5">
          {(
            [
              ["canvas", "畫布", LayoutGrid],
              ["scene", "物件聖經", Box],
              ["pano", "360 環景", Globe],
              ["delivery", "交付", Package],
            ] as [WsTab, string, React.ComponentType<{ className?: string }>][]
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium",
                tab === k ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "canvas" && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-background px-4 py-2 text-[11px] text-muted-foreground sm:px-6">
            <span className="font-medium text-foreground">流程</span>
            <span>① 拖入各視角 3D 原圖</span>
            <span>② 主圖（20／33）先做、主管核准</span>
            <span>③ 衍生視角自動帶入核准主圖當參考</span>
            <span>④ 修正一律框選區域、開新版本</span>
            <span className="hidden lg:inline">風格基準：</span>
            <input
              className="hidden min-w-[240px] flex-1 rounded border border-transparent bg-transparent px-1 text-[11px] hover:border-border focus:border-border lg:block"
              list="style-presets"
              placeholder="全案風格方向（可選或輸入，會寫進每份提示詞）"
              value={project.styleBrief}
              onChange={(e) => mutate(project.id, (d) => void (d.styleBrief = e.target.value))}
            />
          </div>
          <datalist id="style-presets">
            {STYLE_PRESETS.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <div className="relative min-h-[420px] flex-1">
            <CanvasBoard
              project={project}
              h={{
                onOpenVersion: setEditing,
                onNewVersion: newVersion,
                onOpenOriginal: setOriginal,
                onAddView: () => {
                  // 編號預設接在現有最大號之後，多數情況直接按新增即可
                  const nums = project.views.map((v) => Number(v.id)).filter((n) => Number.isFinite(n));
                  setNv({ id: nums.length ? String(Math.max(...nums) + 1) : "1", name: "", room: "", role: "standalone", dependsOn: [] });
                  setShot("");
                  setNewView(true);
                },
                onError: toast.bad,
              }}
            />
          </div>
        </>
      )}
      {tab === "scene" && <ScenePanel project={project} onError={toast.bad} />}
      {tab === "pano" && <PanoPanel project={project} />}
      {tab === "delivery" && <DeliveryPanel project={project} />}

      {editing && (
        <VersionEditor project={project} versionId={editing} onClose={() => setEditing(null)} onSwitch={setEditing} />
      )}

      <Modal open={!!origView} onClose={() => setOriginal(null)} title={origView ? `視角 ${origView.id} · 3D 原圖（唯讀）` : ""} wide>
        {origView && (
          <div className="space-y-3 p-4">
            <AssetImg id={origView.originalAssetId} alt="原圖" className="mx-auto max-h-[70vh] w-auto rounded-lg" />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {origMeta && (
                <>
                  <Pill>
                    {origMeta.width}×{origMeta.height}
                  </Pill>
                  <span className="font-mono">SHA-256 {origMeta.sha256}</span>
                </>
              )}
              <Button
                size="sm"
                className="ml-auto"
                disabled={!!busy}
                onClick={() =>
                  run("new", async () => {
                    const id = await createDraft(project.id, origView.id, "original");
                    setOriginal(null);
                    setEditing(id);
                  })
                }
              >
                從原圖開新版本
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={newView} onClose={() => setNewView(false)} title="新增視角">
        <form
          className="space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            run("view", async () => {
              await addView(project.id, nv);
              setNewView(false);
              setNv({ id: "", name: "", room: "", role: "standalone", dependsOn: [] });
              setShot("");
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1 text-xs font-medium">
              空間
              <ChoiceInput
                value={nv.room}
                onChange={(room) => setNv({ ...nv, room, name: !nv.name || nv.name === `${nv.room}${shot}` ? `${room}${shot}` : nv.name })}
                options={ROOM_OPTIONS}
                emptyLabel="請選擇"
                placeholder="例：視聽室"
              />
            </div>
            <label className="space-y-1 text-xs font-medium">
              景別
              <select
                className={inputCls}
                value={shot}
                onChange={(e) => {
                  const next = e.target.value;
                  setShot(next);
                  if (!nv.name || nv.name === `${nv.room}${shot}`) setNv({ ...nv, name: `${nv.room}${next}` });
                }}
              >
                <option value="">請選擇</option>
                {SHOT_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-xs font-medium">
              編號
              <input className={inputCls} inputMode="numeric" value={nv.id} onChange={(e) => setNv({ ...nv, id: e.target.value.trim() })} placeholder="21" />
            </label>
            <label className="col-span-2 space-y-1 text-xs font-medium">
              名稱（自動帶入，可改）
              <input className={inputCls} value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} placeholder="餐廚正景" />
            </label>
          </div>
          <label className="block space-y-1 text-xs font-medium">
            角色
            <select className={inputCls} value={nv.role} onChange={(e) => setNv({ ...nv, role: e.target.value as ViewRole, dependsOn: e.target.value === "derived" ? nv.dependsOn : [] })}>
              <option value="master">主圖（定義該空間的設計）</option>
              <option value="derived">衍生（讀取主圖的物件與材質）</option>
              <option value="standalone">獨立</option>
            </select>
          </label>
          {nv.role === "derived" && (
            <div className="space-y-1 text-xs font-medium">
              依賴的主圖
              <div className="flex flex-wrap gap-2">
                {project.views
                  .filter((v) => v.role === "master")
                  .map((m) => (
                    <label key={m.id} className="inline-flex items-center gap-1 font-normal">
                      <input
                        type="checkbox"
                        checked={nv.dependsOn.includes(m.id)}
                        onChange={(e) =>
                          setNv({ ...nv, dependsOn: e.target.checked ? [...nv.dependsOn, m.id] : nv.dependsOn.filter((x) => x !== m.id) })
                        }
                      />
                      {m.id} {m.name}
                    </label>
                  ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setNewView(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!!busy}>
              新增
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
