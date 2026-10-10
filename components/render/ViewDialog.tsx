"use client";

import * as React from "react";
import { ImagePlus, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/lib/render/company";
import { DEFAULT_ROOMS, suggestViewNumbers } from "@/lib/render/company-types";
import { SHOT_OPTIONS } from "@/lib/render/options";
import type { RenderProject, ViewRole } from "@/lib/render/types";
import { ChoiceInput, inputCls, Modal } from "./primitives";

export interface ViewFields {
  id: string;
  name: string;
  room: string;
  role: ViewRole;
  dependsOn: string[];
}

/**
 * 新增／編輯視角。新增時可直接選 3D 原圖（插入圖片＋命名一次完成）；
 * 空間與圖號來自後台的公司預設，圖號留空就自動編。
 */
export function ViewDialog({
  project,
  editId,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  project: RenderProject;
  /** 有值＝編輯既有視角 */
  editId: string | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fields: ViewFields, file: File | null) => void;
}) {
  const title = editId ? `編輯視角 ${editId}` : "新增視角（插入圖片）";
  // 表單放在 Modal 內：關閉即卸載，下次打開一定是乾淨的初始值，不會殘留上一次的空間或景別
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <ViewForm project={project} editId={editId} busy={busy} onClose={onClose} onSubmit={onSubmit} />
    </Modal>
  );
}

function ViewForm({
  project,
  editId,
  busy,
  onClose,
  onSubmit,
}: {
  project: RenderProject;
  editId: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fields: ViewFields, file: File | null) => void;
}) {
  const { data: company } = useCompany();
  const rooms = company?.rooms ?? DEFAULT_ROOMS;
  const editing = editId ? project.views.find((v) => v.id === editId) ?? null : null;
  const [f, setF] = React.useState<ViewFields>(() =>
    editing
      ? { id: editing.id, name: editing.name, room: editing.room, role: editing.role, dependsOn: editing.dependsOn }
      : { id: "", name: "", room: "", role: "standalone", dependsOn: [] },
  );
  const [shot, setShot] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const existing = project.views.map((v) => v.id);
  const suggestions = editing ? [] : suggestViewNumbers(existing, f.room, rooms);
  const autoName = (room: string, s: string) => `${room}${s}`;
  const nameIsAuto = !f.name || f.name === autoName(f.room, shot);
  const masters = project.views.filter((v) => v.role === "master" && v.id !== editId);
  const duplicate = !editing && f.id.trim() !== "" && existing.includes(f.id.trim());

  return (
    <form
      className="space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const id = editing ? editing.id : f.id.trim() || suggestions[0] || "1";
        const name = f.name.trim() || autoName(f.room, shot) || `視角 ${id}`;
        onSubmit({ ...f, id, name }, file);
      }}
    >
      {!editing && (
        <div className="space-y-1 text-xs font-medium">
          3D 原圖（可稍後再放）
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <ImagePlus /> {file ? "換一張" : "選擇圖片"}
            </Button>
            <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">{file ? file.name : "PNG／JPG／WebP"}</span>
          </div>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1 text-xs font-medium">
          空間
          <ChoiceInput
            value={f.room}
            onChange={(room) => setF({ ...f, room, name: nameIsAuto ? autoName(room, shot) : f.name })}
            options={rooms.map((r) => r.name)}
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
              if (nameIsAuto) setF({ ...f, name: autoName(f.room, next) });
            }}
          >
            <option value="">{editing ? "不變" : "請選擇"}</option>
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
          圖號
          {editing ? (
            <input className={inputCls} value={editing.id} disabled />
          ) : (
            <>
              <input
                className={inputCls}
                inputMode="numeric"
                list="view-number-options"
                value={f.id}
                onChange={(e) => setF({ ...f, id: e.target.value.trim() })}
                placeholder={`留空自動：${suggestions[0] ?? ""}`}
              />
              <datalist id="view-number-options">
                {suggestions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </>
          )}
        </label>
        <label className="col-span-2 space-y-1 text-xs font-medium">
          名稱（自動帶入，可改）
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：客廳正景" />
        </label>
      </div>
      {duplicate && <p className="text-[11px] text-danger">圖號 {f.id} 已經有了，請換一個或留空自動編。</p>}
      {editing && <p className="text-[11px] text-muted-foreground">圖號不能改：版本紀錄、物件聖經都用圖號串接。</p>}

      <label className="block space-y-1 text-xs font-medium">
        角色
        <select
          className={inputCls}
          value={f.role}
          onChange={(e) => setF({ ...f, role: e.target.value as ViewRole, dependsOn: e.target.value === "derived" ? f.dependsOn : [] })}
        >
          <option value="master">主圖（定義這個空間的設計，先做先核准）</option>
          <option value="derived">衍生（沿用主圖的家具、材質、數量）</option>
          <option value="standalone">獨立（不與其他視角連動）</option>
        </select>
      </label>
      {f.role === "derived" && (
        <div className="space-y-1.5 rounded-lg border border-border p-2.5 text-xs">
          <p className="flex items-center gap-1 font-medium">
            <Link2 className="h-3.5 w-3.5" /> 依賴的主圖（畫布上會畫連線）
          </p>
          {masters.length ? (
            <div className="flex flex-wrap gap-2">
              {masters.map((m) => (
                <label key={m.id} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={f.dependsOn.includes(m.id)}
                    onChange={(e) => setF({ ...f, dependsOn: e.target.checked ? [...f.dependsOn, m.id] : f.dependsOn.filter((x) => x !== m.id) })}
                  />
                  {m.id} {m.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">專案裡還沒有主圖。先把同空間最重要的一張設為「主圖」。</p>
          )}
          <p className="text-[11px] text-muted-foreground">主圖核准後，這張開新版本會自動帶入主圖當參考；主圖改版，這張已核准的版本會標「需重驗」。</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={busy || duplicate}>
          {editing ? "儲存" : file ? "新增並放入原圖" : "新增"}
        </Button>
      </div>
    </form>
  );
}
