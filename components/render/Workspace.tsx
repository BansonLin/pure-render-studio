"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Box, Globe, LayoutGrid, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRenderProject, useRenderStore } from "@/store/render-store";
import { addView, createDraft, setOriginal as setOriginalImage, updateView } from "@/lib/render/actions";
import { CanvasBoard } from "./CanvasBoard";
import { VersionEditor } from "./VersionEditor";
import { ScenePanel } from "./ScenePanel";
import { PanoPanel } from "./PanoPanel";
import { DeliveryPanel } from "./DeliveryPanel";
import { AssetImg, Modal, Pill, useBusy, useToast } from "./primitives";
import { STYLE_PRESETS } from "@/lib/render/options";
import { ViewDialog } from "./ViewDialog";
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
  const [editView, setEditView] = React.useState<string | null>(null);

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
                onAddView: () => setNewView(true),
                onEditView: setEditView,
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

      <ViewDialog
        project={project}
        editId={editView}
        open={newView || !!editView}
        busy={!!busy}
        onClose={() => {
          setNewView(false);
          setEditView(null);
        }}
        onSubmit={(fields, file) =>
          run("view", async () => {
            if (editView) {
              await updateView(project.id, editView, fields);
              setEditView(null);
              toast.ok(`已更新視角 ${fields.id}`);
              return;
            }
            await addView(project.id, fields);
            if (file) await setOriginalImage(project.id, fields.id, file);
            setNewView(false);
            toast.ok(`已新增視角 ${fields.id}${file ? "並放入原圖" : ""}`);
          })
        }
      />
    </div>
  );
}
