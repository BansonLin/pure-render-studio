"use client";

import { assetBlob, useRenderStore } from "@/store/render-store";
import { annotationGuide, buildCandidate, maskPng, runRippleQa } from "./composite";
import { COMPILER_VERSION, compilePrompt, shapeBounds } from "./compiler";
import { canvasToBlob, ctx2d, decodeImage, downloadBlob, makeCanvas, uid, blobToBase64, base64ToBlob } from "./image";
import { DEFAULT_BLOCK_IDS } from "./prompt-blocks";
import { generateViaApi, OutcomeUnknownError, PROVIDER_CAPS } from "./provider";
import { REFERENCE_ROLE_LABEL } from "./types";
import type { AssetKind, AssetMeta, BaseStrategy, ReferenceSlot, RenderProject, Version } from "./types";
import { childDepth, DEFAULT_QA_CHECKS, invalidateDependents, nextLabel, versionsOf } from "./workflow";
import { blobEntry, buildZip, textEntry, type ZipEntry } from "./zip";

const store = () => useRenderStore.getState();
const now = () => new Date().toISOString();

function project(id: string): RenderProject {
  const p = store().projects[id];
  if (!p) throw new Error("找不到專案");
  return p;
}

export async function addAssetFromFile(projectId: string, file: Blob, kind: AssetKind, name: string) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("僅支援 PNG / JPG / WEBP。");
  if (file.size > 40 * 1024 * 1024) throw new Error("單張超過 40MB。");
  return store().addAsset(projectId, file, kind, name);
}

// ---------- 視角與素材 ----------

export async function setOriginal(projectId: string, viewId: string, file: File) {
  const p = project(projectId);
  if (versionsOf(p, viewId).some((v) => v.state !== "draft")) {
    throw new Error("此視角已有生成紀錄；原圖唯讀不可替換。請新增視角。");
  }
  const meta = await addAssetFromFile(projectId, file, "original", file.name);
  await store().mutate(projectId, (d) => {
    const v = d.views.find((x) => x.id === viewId);
    if (v) v.originalAssetId = meta.id;
  });
  return meta;
}

export async function addView(projectId: string, fields: { id: string; name: string; room: string; role: "master" | "derived" | "standalone"; dependsOn: string[] }) {
  const p = project(projectId);
  if (!fields.id.trim()) throw new Error("請填視角編號");
  if (p.views.some((v) => v.id === fields.id)) throw new Error(`視角 ${fields.id} 已存在`);
  const maxY = p.views.reduce((m, v) => Math.max(m, v.canvas.y), 0);
  await store().mutate(projectId, (d) => {
    d.views.push({
      ...fields,
      originalAssetId: null,
      acceptedVersionId: null,
      canvas: { x: 80, y: d.views.length ? maxY + 220 : 80 },
      notes: "",
    });
  });
}

/**
 * 修改視角的名稱、空間、角色與依賴主圖。編號不開放改：版本、物件聖經、釘選紀錄都以編號串接。
 * 主圖關係改動只影響之後新開的版本；已送出的版本仍保留當時釘選的主圖。
 */
export async function updateView(
  projectId: string,
  viewId: string,
  fields: { name: string; room: string; role: "master" | "derived" | "standalone"; dependsOn: string[] },
) {
  await store().mutate(projectId, (d) => {
    const v = d.views.find((x) => x.id === viewId);
    if (!v) return;
    v.name = fields.name.trim() || v.name;
    v.room = fields.room.trim();
    v.role = fields.role;
    v.dependsOn = fields.role === "derived" ? fields.dependsOn.filter((id) => id !== viewId && d.views.some((x) => x.id === id)) : [];
  });
}

export async function addProjectReference(projectId: string, file: File) {
  const meta = await addAssetFromFile(projectId, file, "reference", file.name);
  await store().mutate(projectId, (d) => {
    d.references.push({ assetId: meta.id, label: file.name.replace(/\.[^.]+$/, ""), role: "object" });
  });
  return meta;
}

// ---------- 版本 ----------

export function baseAssetFor(p: RenderProject, viewId: string, strategy: BaseStrategy, parentId: string | null) {
  const view = p.views.find((v) => v.id === viewId);
  if (!view) return null;
  if (strategy === "original") return view.originalAssetId;
  if (strategy === "accepted") {
    const acc = p.versions.find((v) => v.id === view.acceptedVersionId);
    return acc?.resultAssetId ?? null;
  }
  const parent = p.versions.find((v) => v.id === parentId);
  return parent?.resultAssetId ?? null;
}

/** 依視角角色自動建議參考圖：衍生視角帶入已核准主圖 */
export function suggestedReferences(p: RenderProject, viewId: string): ReferenceSlot[] {
  const view = p.views.find((v) => v.id === viewId);
  if (!view) return [];
  const refs: ReferenceSlot[] = [];
  for (const mid of view.dependsOn) {
    const m = p.views.find((v) => v.id === mid);
    const acc = p.versions.find((v) => v.id === m?.acceptedVersionId);
    if (!m || !acc?.resultAssetId) continue;
    const shared = p.sceneObjects
      .filter((o) => {
        const a = o.views[mid];
        const b = o.views[viewId];
        return (a === "visible" || a === "partial") && b !== "hidden";
      })
      .map((o) => o.name);
    refs.push({
      assetId: acc.resultAssetId,
      role: "master-view",
      note: shared.length ? `${shared.join("、")}（造型、材質、數量）` : "共用材質與擺件",
      source: "pinned-master",
    });
  }
  return refs;
}

export async function createDraft(projectId: string, viewId: string, strategy: BaseStrategy, parentVersionId: string | null = null) {
  const p = project(projectId);
  const base = baseAssetFor(p, viewId, strategy, parentVersionId);
  if (!base) throw new Error(strategy === "original" ? "請先放入此視角的 3D 原圖。" : "找不到可用的底圖版本。");
  const parent = p.versions.find((v) => v.id === parentVersionId) ??
    (strategy === "accepted" ? p.versions.find((v) => v.id === p.views.find((x) => x.id === viewId)?.acceptedVersionId) : undefined);
  const id = uid("ver");
  const draft: Version = {
    id,
    viewId,
    label: nextLabel(p, viewId),
    createdAt: now(),
    baseStrategy: strategy,
    baseAssetId: base,
    parentVersionId: strategy === "original" ? null : parent?.id ?? null,
    generationDepth: strategy === "original" ? 0 : parent?.generationDepth ?? 0,
    rawRequest: "",
    regions: [],
    blockIds: [...DEFAULT_BLOCK_IDS],
    references: suggestedReferences(p, viewId),
    compiledPrompt: "",
    compilerVersion: COMPILER_VERSION,
    pinnedMasters: [],
    provider: "manual",
    providerJobId: null,
    rawResultAssetId: null,
    resultAssetId: null,
    composited: false,
    state: "draft",
    qa: null,
    acceptance: null,
    events: [{ at: now(), type: "created", detail: `底圖策略：${strategy}` }],
  };
  await store().mutate(projectId, (d) => {
    d.versions.push(draft);
  });
  return id;
}

export async function patchVersion(projectId: string, versionId: string, fn: (v: Version) => void) {
  await store().mutate(projectId, (d) => {
    const v = d.versions.find((x) => x.id === versionId);
    if (v) fn(v);
  });
}

export function referenceLabels(p: RenderProject, assets: Record<string, AssetMeta>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const r of p.references) labels[r.assetId] = r.label;
  for (const o of p.sceneObjects) if (o.referenceAssetId) labels[o.referenceAssetId] = `物件：${o.name}`;
  for (const v of p.versions) {
    if (!v.resultAssetId) continue;
    const view = p.views.find((x) => x.id === v.viewId);
    labels[v.resultAssetId] = `視角 ${v.viewId} ${view?.name ?? ""} ${v.label}`.trim();
  }
  for (const [id, a] of Object.entries(assets)) if (!labels[id]) labels[id] = a.name;
  return labels;
}

export function compileVersion(p: RenderProject, v: Version, assets: Record<string, AssetMeta>, opts: { includeSceneContract: boolean; maskSupported: boolean; annotation: boolean }) {
  const view = p.views.find((x) => x.id === v.viewId)!;
  const refs = [...v.references];
  if (opts.annotation && v.regions.length) refs.push({ assetId: "__annotation__", role: "annotation", note: "", source: "manual" });
  return compilePrompt({
    project: p,
    view,
    rawRequest: v.rawRequest,
    regions: v.regions,
    blockIds: v.blockIds,
    references: refs,
    referenceLabels: { ...referenceLabels(p, assets), __annotation__: "標註示意" },
    includeSceneContract: opts.includeSceneContract,
    maskSupported: opts.maskSupported,
  });
}

function pinMasters(p: RenderProject, viewId: string) {
  const view = p.views.find((x) => x.id === viewId)!;
  return view.dependsOn
    .map((mid) => {
      const m = p.views.find((x) => x.id === mid);
      const acc = p.versions.find((x) => x.id === m?.acceptedVersionId);
      const meta = acc?.resultAssetId ? store().assets[acc.resultAssetId] : null;
      return acc && meta ? { viewId: mid, versionId: acc.id, sha256: meta.sha256 } : null;
    })
    .filter(Boolean) as Version["pinnedMasters"];
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);

/** ChatGPT 手動模式：匯出任務包 ZIP */
export async function exportManualPackage(projectId: string, versionId: string, opts: { includeSceneContract: boolean; annotation: boolean }) {
  const p = project(projectId);
  const v = p.versions.find((x) => x.id === versionId)!;
  const assets = store().assets;
  const { prompt } = compileVersion(p, v, assets, { ...opts, maskSupported: false });
  const base = await assetBlob(v.baseAssetId);
  if (!base) throw new Error("找不到底圖檔案");
  const labels = referenceLabels(p, assets);
  const entries: ZipEntry[] = [];
  const ext = (b: Blob) => (b.type === "image/jpeg" ? "jpg" : b.type === "image/webp" ? "webp" : "png");
  entries.push(await blobEntry(`01_編輯目標_視角${v.viewId}.${ext(base)}`, base));
  let n = 2;
  for (const r of v.references) {
    const b = await assetBlob(r.assetId);
    if (!b) continue;
    entries.push(await blobEntry(`${String(n).padStart(2, "0")}_${REFERENCE_ROLE_LABEL[r.role]}_${safe(labels[r.assetId] ?? "ref")}.${ext(b)}`, b));
    n++;
  }
  if (opts.annotation && v.regions.length) {
    entries.push(await blobEntry(`${String(n).padStart(2, "0")}_標註示意（勿畫出框線）.jpg`, await annotationGuide(base, v.regions)));
    n++;
  }
  const bmp = await decodeImage(base);
  if (v.regions.length) entries.push(await blobEntry("遮罩_透明為修改區.png", await maskPng(v.regions, bmp.width, bmp.height)));
  bmp.close();
  entries.push(textEntry("提示詞.txt", prompt));
  entries.push(
    textEntry(
      "操作說明.txt",
      [
        `專案：${p.code} ${p.name}　視角 ${v.viewId}　版本 ${v.label}`,
        "",
        "1. 開啟 ChatGPT 新對話（每個版本開新對話，避免前文干擾）。",
        `2. 依檔名編號順序上傳 01 ～ ${String(n - 1).padStart(2, "0")} 的圖片（01 一定是編輯目標）。`,
        "3. 貼上「提示詞.txt」全文送出。",
        "4. 下載結果原檔（不要截圖），回到工作台此版本按「匯入 AI 結果」。",
        "5. 系統會自動：放大回原尺寸 → 校正鏡位 → 選區外回貼原像素 → 水波紋篩查。",
        "",
        "注意：不要在同一個對話裡連續要求修第二、第三次——每次都會重新生成整張圖，紋理會一代比一代差。",
        "要修正請回工作台框選問題區域，開新版本、新對話。",
      ].join("\n"),
    ),
  );
  const zip = buildZip(entries);
  downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${safe(p.code || p.name)}_視角${v.viewId}_${v.label}_ChatGPT任務包.zip`);
  await patchVersion(projectId, versionId, (x) => {
    x.compiledPrompt = prompt;
    x.compilerVersion = COMPILER_VERSION;
    x.provider = "manual";
    x.pinnedMasters = pinMasters(p, v.viewId);
    if (x.state === "draft") x.state = "submitted";
    x.events.push({ at: now(), type: "exported", detail: `任務包 ${entries.length} 個檔案` });
  });
}

export interface ImportOptions {
  align: boolean;
  composite: boolean;
  feather: number;
}

/** 匯入 AI 結果 → 建立候選 → 自動 QA */
export async function importResult(projectId: string, versionId: string, file: Blob, opts: ImportOptions) {
  const p = project(projectId);
  const v = p.versions.find((x) => x.id === versionId)!;
  const base = await assetBlob(v.baseAssetId);
  if (!base) throw new Error("找不到底圖檔案");
  const raw = await addAssetFromFile(projectId, file, "candidate", `${v.viewId}_${v.label}_raw`);
  const built = await buildCandidate(base, file, { regions: v.regions, ...opts });
  const cand = await store().addAsset(projectId, built.blob, "candidate", `${v.viewId}_${v.label}`);
  const view = p.views.find((x) => x.id === v.viewId)!;
  const original = view.originalAssetId ? await assetBlob(view.originalAssetId) : null;
  const ripple = await runRippleQa(built.blob, original ?? base, original ? "original" : "base");
  const willComposite = built.composited && v.regions.some((r) => r.kind !== "lock");
  await patchVersion(projectId, versionId, (x) => {
    x.rawResultAssetId = raw.id;
    x.resultAssetId = cand.id;
    x.composited = built.composited;
    x.generationDepth = childDepth(
      x.baseStrategy === "original" ? 0 : (p.versions.find((y) => y.id === x.parentVersionId)?.generationDepth ?? 0),
      willComposite,
    );
    if (!x.pinnedMasters.length) x.pinnedMasters = pinMasters(p, v.viewId);
    if (!x.compiledPrompt) x.compiledPrompt = compileVersion(p, x, store().assets, { includeSceneContract: true, maskSupported: false, annotation: false }).prompt;
    x.state = "qa_pending";
    x.qa = {
      ripple,
      alignment: built.alignment,
      checks: DEFAULT_QA_CHECKS.map((c) => ({ ...c, verdict: null, note: "" })),
    };
    x.events.push({ at: now(), type: "imported", detail: built.notes.join(" ") });
  });
  return built.notes;
}

export async function runApiGeneration(projectId: string, versionId: string, opts: ImportOptions & { includeSceneContract: boolean; quality: "medium" | "high" }) {
  const p = project(projectId);
  const v = p.versions.find((x) => x.id === versionId)!;
  if (v.references.length > PROVIDER_CAPS.openai.maxReferences) throw new Error(`API 模式參考圖最多 ${PROVIDER_CAPS.openai.maxReferences} 張`);
  const base = await assetBlob(v.baseAssetId);
  if (!base) throw new Error("找不到底圖檔案");
  const { prompt } = compileVersion(p, v, store().assets, { includeSceneContract: opts.includeSceneContract, maskSupported: true, annotation: false });
  const toJpeg = async (b: Blob, maxW: number) => {
    const bmp = await decodeImage(b);
    const w = Math.min(maxW, bmp.width);
    const h = Math.round((w * bmp.height) / bmp.width);
    const c = makeCanvas(w, h);
    ctx2d(c).drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvasToBlob(c, "image/jpeg", 0.9);
  };
  // 送原寬（渲染圖多為 2048）：新模型可直接輸出同尺寸，不必先縮小再放大而損失細節
  const baseJ = await toJpeg(base, 2048);
  const bmp = await decodeImage(baseJ);
  const dims = { width: bmp.width, height: bmp.height };
  const mask = v.regions.some((r) => r.kind !== "lock") ? await maskPng(v.regions, bmp.width, bmp.height) : null;
  bmp.close();
  const refs: Blob[] = [];
  for (const r of v.references) {
    const b = await assetBlob(r.assetId);
    if (b) refs.push(await toJpeg(b, 768));
  }
  const requestId = uid("req");
  await patchVersion(projectId, versionId, (x) => {
    x.compiledPrompt = prompt;
    x.provider = "openai";
    x.providerJobId = requestId;
    x.pinnedMasters = pinMasters(p, v.viewId);
    x.state = "submitted";
    x.events.push({ at: now(), type: "api_submitted", detail: requestId });
  });
  try {
    const out = await generateViaApi({ requestId, prompt, base: baseJ, mask, references: refs, quality: opts.quality, ...dims });
    await patchVersion(projectId, versionId, (x) => {
      x.events.push({ at: now(), type: "api_returned", detail: `model=${out.model ?? "unknown"}` });
    });
    return importResult(projectId, versionId, out.image, opts);
  } catch (e) {
    const unknown = e instanceof OutcomeUnknownError;
    await patchVersion(projectId, versionId, (x) => {
      x.state = unknown ? "outcome_unknown" : "failed";
      x.events.push({ at: now(), type: unknown ? "outcome_unknown" : "failed", detail: (e as Error).message });
    });
    throw e;
  }
}

export async function setState(projectId: string, versionId: string, state: Version["state"], detail?: string) {
  await patchVersion(projectId, versionId, (x) => {
    x.state = state;
    x.events.push({ at: now(), type: state, detail });
  });
}

export async function acceptVersion(projectId: string, versionId: string, by: string, note: string) {
  if (!by.trim()) throw new Error("請填核准者");
  let touched: string[] = [];
  await store().mutate(projectId, (d) => {
    const v = d.versions.find((x) => x.id === versionId);
    const view = d.views.find((x) => x.id === v?.viewId);
    if (!v || !view || !v.resultAssetId) return;
    const prev = view.acceptedVersionId;
    v.state = "accepted";
    v.acceptance = { by: by.trim(), at: now(), note: note.trim() };
    v.events.push({ at: now(), type: "accepted", detail: `${by}${note ? `：${note}` : ""}` });
    view.acceptedVersionId = v.id;
    if (prev && prev !== v.id) {
      const old = d.versions.find((x) => x.id === prev);
      old?.events.push({ at: now(), type: "superseded", detail: `由 ${v.label} 取代` });
    }
    touched = invalidateDependents(d, view.id);
  });
  return touched.length;
}

/** 從版本結果裁出物件參考圖，存進場景物件 */
export async function cropToObject(projectId: string, versionId: string, regionId: string, objectId: string) {
  const p = project(projectId);
  const v = p.versions.find((x) => x.id === versionId)!;
  const r = v.regions.find((x) => x.id === regionId);
  const src = v.resultAssetId ?? v.baseAssetId;
  const blob = await assetBlob(src);
  if (!r || !blob) throw new Error("找不到區域或影像");
  const bmp = await decodeImage(blob);
  const b = shapeBounds(r.shape, bmp.width / bmp.height);
  const pad = 0.02;
  const x = Math.max(0, b.x - pad) * bmp.width;
  const y = Math.max(0, b.y - pad) * bmp.height;
  const w = Math.min(bmp.width - x, (b.w + pad * 2) * bmp.width);
  const h = Math.min(bmp.height - y, (b.h + pad * 2) * bmp.height);
  const c = makeCanvas(Math.round(w), Math.round(h));
  ctx2d(c).drawImage(bmp, x, y, w, h, 0, 0, c.width, c.height);
  bmp.close();
  const obj = p.sceneObjects.find((o) => o.id === objectId);
  const meta = await store().addAsset(projectId, await canvasToBlob(c), "object-crop", `物件_${obj?.name ?? objectId}`);
  await store().mutate(projectId, (d) => {
    const o = d.sceneObjects.find((x) => x.id === objectId);
    if (o) o.referenceAssetId = meta.id;
  });
}

// ---------- 交付與備份 ----------

export async function exportDelivery(projectId: string) {
  const p = project(projectId);
  const assets = store().assets;
  const entries: ZipEntry[] = [];
  const manifest: unknown[] = [];
  for (const view of p.views) {
    const acc = p.versions.find((x) => x.id === view.acceptedVersionId);
    const orig = view.originalAssetId ? assets[view.originalAssetId] : null;
    const res = acc?.resultAssetId ? assets[acc.resultAssetId] : null;
    if (acc && res) {
      const b = await assetBlob(res.id);
      if (b) entries.push(await blobEntry(`成品/${view.id}_${safe(view.name)}_${acc.label}.png`, b));
      entries.push(textEntry(`提示詞/${view.id}_${acc.label}.txt`, acc.compiledPrompt));
    }
    if (orig) {
      const b = await assetBlob(orig.id);
      if (b) entries.push(await blobEntry(`原圖對照/${view.id}_${safe(view.name)}.${orig.mime === "image/png" ? "png" : "jpg"}`, b));
    }
    manifest.push({
      view_id: view.id,
      name: view.name,
      role: view.role,
      original_sha256: orig?.sha256 ?? null,
      accepted_version: acc?.label ?? null,
      result_sha256: res?.sha256 ?? null,
      base_strategy: acc?.baseStrategy ?? null,
      generation_depth: acc?.generationDepth ?? null,
      composited: acc?.composited ?? null,
      pinned_masters: acc?.pinnedMasters ?? [],
      raw_request: acc?.rawRequest ?? null,
      compiler_version: acc?.compilerVersion ?? null,
      provider: acc?.provider ?? null,
      qa_ripple_suspect_ratio: acc?.qa?.ripple?.suspectRatio ?? null,
      qa_checks: acc?.qa?.checks ?? [],
      human_accepted: acc?.acceptance ? true : null,
      accepted_by: acc?.acceptance?.by ?? null,
      accepted_at: acc?.acceptance?.at ?? null,
      acceptance_note: acc?.acceptance?.note ?? null,
      known_limitations: "2D 影像編修不能證明毫米級尺寸不變；精準尺寸以原 3D 模型與施工圖為準。",
    });
  }
  entries.push(textEntry("manifest.json", JSON.stringify({ project: { code: p.code, name: p.name, floor: p.floor }, exported_at: now(), views: manifest }, null, 2)));
  const zip = buildZip(entries);
  downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${safe(p.code || p.name)}_交付包.zip`);
}

export interface Backup {
  format: "pure-render-studio";
  version: 1;
  project: RenderProject;
  assets: (AssetMeta & { b64: string })[];
}

export async function exportBackup(projectId: string) {
  const p = project(projectId);
  const metas = Object.values(store().assets).filter((a) => a.projectId === projectId);
  const assets: Backup["assets"] = [];
  for (const m of metas) {
    const b = await assetBlob(m.id);
    if (b) assets.push({ ...m, b64: await blobToBase64(b) });
  }
  const data: Backup = { format: "pure-render-studio", version: 1, project: p, assets };
  downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `${safe(p.code || p.name)}_專案備份.json`);
}

export interface ParsedBackup {
  data: Backup;
  /** 此裝置上已有同 ID 的專案（跨裝置來回搬移時常見） */
  existing: RenderProject | null;
}

export async function readBackup(file: File): Promise<ParsedBackup> {
  const data = JSON.parse(await file.text()) as Backup;
  if (data.format !== "pure-render-studio" || data.version !== 1) throw new Error("不是工作台專案備份檔");
  return { data, existing: store().projects[data.project.id] ?? null };
}

/**
 * 寫入備份。replace 時先寫新資料、最後才刪掉備份裡沒有的舊圖，
 * 中途失敗也不會讓此裝置上的專案只剩一半。
 */
export async function importBackup({ data, existing }: ParsedBackup, opts: { replace?: boolean } = {}) {
  if (existing && !opts.replace) throw new Error("此裝置已有同一個專案；要以備份覆蓋請確認後再匯入");
  for (const a of data.assets) {
    const { b64, ...meta } = a;
    await store().restoreAsset(meta, base64ToBlob(b64, meta.mime));
  }
  const { deleteAssets, putProject } = await import("./db");
  await putProject(data.project);
  if (existing) {
    const keep = new Set(data.assets.map((a) => a.id));
    const stale = Object.values(store().assets)
      .filter((a) => a.projectId === data.project.id && !keep.has(a.id))
      .map((a) => a.id);
    await deleteAssets(stale);
  }
  await store().loadAll();
  return data.project.id;
}
