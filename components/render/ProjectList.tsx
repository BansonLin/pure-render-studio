"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRenderStore } from "@/store/render-store";
import { importBackup, readBackup } from "@/lib/render/actions";
import { AssetImg, ChoiceInput, FileButton, inputCls, Modal, Pill, useBusy, useToast } from "./primitives";
import { FLOOR_OPTIONS } from "@/lib/render/options";
import { RenderBoot } from "./RenderBoot";

export function ProjectList() {
  return (
    <RenderBoot>
      <ProjectListInner />
    </RenderBoot>
  );
}

function ProjectListInner() {
  const projects = useRenderStore((s) => s.projects);
  const createProject = useRenderStore((s) => s.createProject);
  const removeProject = useRenderStore((s) => s.removeProject);
  const router = useRouter();
  const toast = useToast();
  const { busy, run } = useBusy(toast);
  const [openNew, setOpenNew] = React.useState(false);
  const [fields, setFields] = React.useState({ code: "", name: "", floor: "" });
  const list = Object.values(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <main className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
      {toast.node}
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Render Studio · V1 試行</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">以專案為單位，把所有視角放上同一張畫布</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            原圖唯讀、每次修改另存版本；框選區域下指令、匯回時自動校正鏡位並回貼選區外像素，避免水波紋一代代累積。主圖核准後，衍生視角才讀取同一份物件聖經。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpenNew(true)}>
            <Plus /> 新專案
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              run("seed", async () => {
                const id = await createProject("zhongdao");
                router.push(`/p/${id}`);
              })
            }
          >
            <Sparkles /> 載入範本：中道森活一樓
          </Button>
          <FileButton
            accept="application/json,.json"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
            onFiles={([f]) =>
              run("import", async () => {
                const parsed = await readBackup(f);
                const cur = parsed.existing;
                if (cur) {
                  const fileAt = parsed.data.project.updatedAt;
                  const fmt = (t: string) => new Date(t).toLocaleString("zh-TW", { hour12: false });
                  const older = fileAt < cur.updatedAt;
                  const ok = confirm(
                    `此裝置已有「${cur.name}」（最後修改 ${fmt(cur.updatedAt)}）。\n` +
                      `備份檔最後修改 ${fmt(fileAt)}${older ? "，比此裝置上的版本舊" : ""}。\n\n` +
                      `要以備份檔覆蓋此裝置上的專案嗎？${older ? "此裝置上較新的修改會消失。" : ""}`,
                  );
                  if (!ok) return;
                }
                const id = await importBackup(parsed, { replace: !!cur });
                toast.ok(cur ? "已用備份更新此專案" : "已匯入專案備份");
                router.push(`/p/${id}`);
              })
            }
          >
            <Upload className="h-4 w-4" /> 匯入備份
          </FileButton>
        </div>
      </section>

      <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-xs text-warning">
        V1 資料只存在這台裝置的瀏覽器，電腦、平板、手機彼此不同步，清除網站資料也會消失。換裝置接續：在「交付」分頁匯出專案備份，到另一台按「匯入備份」。
      </div>

      {list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">尚無專案</p>
          <p className="max-w-md text-xs text-muted-foreground">
            建議先載入「中道森活一樓」範本：已內建 20／33 主圖、29／34 衍生視角與 11 項場景物件規格，拖入原圖即可開始。
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const cover = p.views.find((v) => v.acceptedVersionId)
              ? p.versions.find((x) => x.id === p.views.find((v) => v.acceptedVersionId)!.acceptedVersionId)?.resultAssetId
              : p.views.find((v) => v.originalAssetId)?.originalAssetId;
            const accepted = p.views.filter((v) => v.acceptedVersionId).length;
            const pending = p.versions.filter((v) => v.state === "human_review_pending").length;
            const reval = p.versions.filter((v) => v.state === "needs_revalidation").length;
            return (
              <Card key={p.id} className="group overflow-hidden">
                <Link href={`/p/${p.id}`} className="block">
                  <div className="aspect-video bg-muted">
                    {cover && <AssetImg id={cover} alt={p.name} className="h-full w-full object-cover" />}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{p.code || "—"}</span>
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Pill>{p.views.length} 視角</Pill>
                      <Pill>{p.versions.length} 版本</Pill>
                      <Pill tone={accepted ? "ok" : "muted"}>
                        已核准 {accepted}/{p.views.length}
                      </Pill>
                      {pending > 0 && <Pill tone="info">待核准 {pending}</Pill>}
                      {reval > 0 && <Pill tone="warn">需重驗 {reval}</Pill>}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      更新 {new Date(p.updatedAt).toLocaleString("zh-TW", { hour12: false })}
                    </p>
                  </div>
                </Link>
                <div className="flex justify-end border-t border-border px-3 py-2">
                  <button
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    onClick={() => {
                      if (confirm(`刪除「${p.name}」與其所有圖片？此動作無法復原（建議先匯出備份）。`)) {
                        run("delete", () => removeProject(p.id));
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 刪除
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={openNew} onClose={() => setOpenNew(false)} title="新專案">
        <form
          className="space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            run("create", async () => {
              const id = await createProject("blank", {
                code: fields.code.trim(),
                name: fields.name.trim() || "未命名專案",
                floor: fields.floor.trim(),
              });
              setOpenNew(false);
              router.push(`/p/${id}`);
            });
          }}
        >
          <label className="block space-y-1 text-xs font-medium">
            案號（只填代號，避免業主姓名與地址）
            <input className={inputCls} value={fields.code} onChange={(e) => setFields({ ...fields, code: e.target.value })} placeholder="例：YL-2611" />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            專案名稱
            <input className={inputCls} value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} placeholder="例：宜蘭游公館 2F" />
          </label>
          <div className="block space-y-1 text-xs font-medium">
            樓層／範圍
            <ChoiceInput
              value={fields.floor}
              onChange={(floor) => setFields({ ...fields, floor })}
              options={FLOOR_OPTIONS}
              emptyLabel="請選擇"
              placeholder="例：3F 局部"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpenNew(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!!busy}>
              建立
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
