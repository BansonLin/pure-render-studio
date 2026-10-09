"use client";

import * as React from "react";
import { Archive, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRenderStore } from "@/store/render-store";
import { exportBackup, exportDelivery } from "@/lib/render/actions";
import { STATE_LABEL } from "@/lib/render/workflow";
import type { RenderProject } from "@/lib/render/types";
import { AssetImg, inputCls, Pill, useBusy, useToast } from "./primitives";

export function DeliveryPanel({ project }: { project: RenderProject }) {
  const assets = useRenderStore((s) => s.assets);
  const mutate = useRenderStore((s) => s.mutate);
  const toast = useToast();
  const { busy, run } = useBusy(toast);
  const accepted = project.views.filter((v) => v.acceptedVersionId).length;
  const reval = project.versions.filter((v) => v.state === "needs_revalidation");

  return (
    <main className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
      {toast.node}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">交付與備份</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            交付包只收「已人工核准」的版本，依 manifest 明列檔案打包（不靠資料夾猜測範圍），附原圖對照、提示詞、QA 與核准紀錄。
            「已生成」「已檢查」「已核准」分開記錄，ZIP 完整不等於視覺合格。
          </p>
        </div>
        <div className="flex gap-2">
          <Button disabled={!!busy || accepted === 0} onClick={() => run("delivery", () => exportDelivery(project.id))}>
            {busy === "delivery" ? <Loader2 className="animate-spin" /> : <Download />} 交付包 ZIP（{accepted}/{project.views.length}）
          </Button>
          <Button variant="outline" disabled={!!busy} onClick={() => run("backup", () => exportBackup(project.id))}>
            {busy === "backup" ? <Loader2 className="animate-spin" /> : <Archive />} 專案備份
          </Button>
        </div>
      </div>

      {reval.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 text-xs text-warning">
          {reval.length} 個版本因主圖改版而需重驗：{reval.map((v) => `${v.viewId} ${v.label}`).join("、")}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="border-b border-border bg-muted/50 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">視角</th>
              <th className="px-2 py-2 text-left font-medium">核准版</th>
              <th className="px-2 py-2 text-left font-medium">底圖策略／世代</th>
              <th className="px-2 py-2 text-left font-medium">水波紋篩查</th>
              <th className="px-2 py-2 text-left font-medium">人工檢查</th>
              <th className="px-2 py-2 text-left font-medium">核准紀錄</th>
              <th className="px-2 py-2 text-left font-medium">版本數</th>
            </tr>
          </thead>
          <tbody>
            {project.views.map((view) => {
              const acc = project.versions.find((x) => x.id === view.acceptedVersionId);
              const all = project.versions.filter((x) => x.viewId === view.id);
              const latest = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
              const pass = acc?.qa?.checks.filter((c) => c.verdict === "pass").length ?? 0;
              const total = acc?.qa?.checks.length ?? 0;
              return (
                <tr key={view.id} className="border-b border-border/60 align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <AssetImg id={acc?.resultAssetId ?? view.originalAssetId} alt="" className="h-10 w-16 rounded object-cover" />
                      <div>
                        <p className="font-medium">
                          {view.id} {view.name}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          原圖 {view.originalAssetId ? assets[view.originalAssetId]?.sha256.slice(0, 10) + "…" : "未放入"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {acc ? <Pill tone="ok">{acc.label}</Pill> : <Pill>{latest ? `最新 ${latest.label}：${STATE_LABEL[latest.state]}` : "尚無版本"}</Pill>}
                  </td>
                  <td className="px-2 py-2 text-[11px]">
                    {acc ? `${acc.baseStrategy === "original" ? "原圖單跳" : acc.baseStrategy === "accepted" ? "從核准版" : "從前版"}／G${acc.generationDepth}${acc.composited ? "・已回貼" : ""}` : "—"}
                  </td>
                  <td className="px-2 py-2 text-[11px]">
                    {acc?.qa?.ripple ? `${(acc.qa.ripple.suspectRatio * 100).toFixed(1)}%（四角 ${Math.round(acc.qa.ripple.cornerMax * 100)}）` : "—"}
                  </td>
                  <td className="px-2 py-2 text-[11px]">{acc ? `${pass}/${total} 通過` : "—"}</td>
                  <td className="px-2 py-2 text-[11px]">
                    {acc?.acceptance ? `${acc.acceptance.by}・${new Date(acc.acceptance.at).toLocaleDateString("zh-TW")}` : "—"}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{all.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="max-w-xl space-y-2 rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">修正上限</h3>
        <p className="text-[11px] text-muted-foreground">
          每個視角首次生成後，允許幾輪「定向修正」。達上限時工作台會提醒停下來人工判斷，而不是無限重跑（一樓 v3 曾 40 筆生成仍有角落殘紋）。
        </p>
        <select
          className={inputCls}
          value={project.repairLimit}
          onChange={(e) => mutate(project.id, (d) => void (d.repairLimit = Number(e.target.value)))}
        >
          {Array.from({ length: Math.max(11, project.repairLimit + 1) }, (_, n) => (
            <option key={n} value={n}>
              {n === 0 ? "0 輪（不做修正，直接人工判斷）" : `${n} 輪${n === 2 ? "（建議）" : ""}`}
            </option>
          ))}
        </select>
      </section>
    </main>
  );
}
