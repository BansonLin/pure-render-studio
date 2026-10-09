"use client";

import type { AssetMeta, RenderProject } from "./types";

/**
 * 本機 IndexedDB 儲存層（V1 試行）。
 *
 * - projects：專案 JSON（不含影像位元組）
 * - assets：資產中繼資料
 * - blobs：影像位元組，以 asset id 為鍵
 *
 * 限制：資料只存在此瀏覽器。換電腦或清除網站資料會遺失，
 * 請用「匯出專案包」備份。階段二改接伺服器儲存（R2 / Supabase）。
 */

const DB_NAME = "pure-render-studio";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("此瀏覽器不支援 IndexedDB，無法保存專案。"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("assets")) {
        const s = db.createObjectStore("assets", { keyPath: "id" });
        s.createIndex("projectId", "projectId");
      }
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("無法開啟本機資料庫。"));
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("交易中止"));
  });
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects(): Promise<RenderProject[]> {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const all = await reqP(tx.objectStore("projects").getAll());
  return (all as RenderProject[]).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function getProject(id: string): Promise<RenderProject | null> {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const p = await reqP(tx.objectStore("projects").get(id));
  return (p as RenderProject | undefined) ?? null;
}

export async function putProject(project: RenderProject): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("projects", "readwrite");
  tx.objectStore("projects").put(project);
  await done(tx);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const assets = await listAssets(id);
  const tx = db.transaction(["projects", "assets", "blobs"], "readwrite");
  tx.objectStore("projects").delete(id);
  for (const a of assets) {
    tx.objectStore("assets").delete(a.id);
    tx.objectStore("blobs").delete(a.id);
  }
  await done(tx);
}

export async function deleteAssets(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction(["assets", "blobs"], "readwrite");
  for (const id of ids) {
    tx.objectStore("assets").delete(id);
    tx.objectStore("blobs").delete(id);
  }
  await done(tx);
}

export async function putAsset(meta: AssetMeta, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["assets", "blobs"], "readwrite");
  tx.objectStore("assets").put(meta);
  tx.objectStore("blobs").put(blob, meta.id);
  await done(tx);
}

export async function getAssetMeta(id: string): Promise<AssetMeta | null> {
  const db = await openDb();
  const tx = db.transaction("assets", "readonly");
  const m = await reqP(tx.objectStore("assets").get(id));
  return (m as AssetMeta | undefined) ?? null;
}

export async function getBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  const tx = db.transaction("blobs", "readonly");
  const b = await reqP(tx.objectStore("blobs").get(id));
  return (b as Blob | undefined) ?? null;
}

export async function listAssets(projectId: string): Promise<AssetMeta[]> {
  const db = await openDb();
  const tx = db.transaction("assets", "readonly");
  const idx = tx.objectStore("assets").index("projectId");
  return (await reqP(idx.getAll(projectId))) as AssetMeta[];
}
