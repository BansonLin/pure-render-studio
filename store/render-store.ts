"use client";

import * as React from "react";
import { create } from "zustand";
import * as db from "@/lib/render/db";
import { decodeImage, sha256, uid } from "@/lib/render/image";
import { blankProject, zhongdaoSeed } from "@/lib/render/seed";
import type { AssetKind, AssetMeta, RenderProject } from "@/lib/render/types";

interface RenderState {
  ready: boolean;
  error: string | null;
  projects: Record<string, RenderProject>;
  assets: Record<string, AssetMeta>;
  loadAll: () => Promise<void>;
  createProject: (
    template: "zhongdao" | "blank",
    fields?: { code: string; name: string; floor: string },
  ) => Promise<string>;
  removeProject: (id: string) => Promise<void>;
  /** 以複本修改後寫回（保留 updatedAt） */
  mutate: (id: string, fn: (draft: RenderProject) => void) => Promise<void>;
  addAsset: (
    projectId: string,
    blob: Blob,
    kind: AssetKind,
    name: string,
  ) => Promise<AssetMeta>;
  /** 直接寫入已知中繼資料（匯入專案包時用） */
  restoreAsset: (meta: AssetMeta, blob: Blob) => Promise<void>;
}

export const useRenderStore = create<RenderState>((set, get) => ({
  ready: false,
  error: null,
  projects: {},
  assets: {},

  loadAll: async () => {
    try {
      const list = await db.listProjects();
      const projects: Record<string, RenderProject> = {};
      const assets: Record<string, AssetMeta> = {};
      for (const p of list) {
        projects[p.id] = p;
        for (const a of await db.listAssets(p.id)) assets[a.id] = a;
      }
      set({ projects, assets, ready: true, error: null });
    } catch (e) {
      set({ ready: true, error: (e as Error).message });
    }
  },

  createProject: async (template, fields) => {
    const now = new Date().toISOString();
    const id = uid("prj");
    const p =
      template === "zhongdao"
        ? zhongdaoSeed(now, id)
        : blankProject(now, id, fields ?? { code: "", name: "未命名專案", floor: "" });
    await db.putProject(p);
    set((s) => ({ projects: { ...s.projects, [id]: p } }));
    return id;
  },

  removeProject: async (id) => {
    await db.deleteProject(id);
    set((s) => {
      const projects = { ...s.projects };
      delete projects[id];
      const assets = Object.fromEntries(
        Object.entries(s.assets).filter(([, a]) => a.projectId !== id),
      );
      return { projects, assets };
    });
  },

  mutate: async (id, fn) => {
    const cur = get().projects[id];
    if (!cur) return;
    const draft = structuredClone(cur);
    fn(draft);
    draft.updatedAt = new Date().toISOString();
    set((s) => ({ projects: { ...s.projects, [id]: draft } }));
    await db.putProject(draft);
  },

  addAsset: async (projectId, blob, kind, name) => {
    const bmp = await decodeImage(blob);
    const meta: AssetMeta = {
      id: uid("ast"),
      projectId,
      kind,
      name,
      sha256: await sha256(blob),
      width: bmp.width,
      height: bmp.height,
      mime: blob.type || "image/png",
      bytes: blob.size,
      createdAt: new Date().toISOString(),
    };
    bmp.close();
    await db.putAsset(meta, blob);
    set((s) => ({ assets: { ...s.assets, [meta.id]: meta } }));
    return meta;
  },

  restoreAsset: async (meta, blob) => {
    await db.putAsset(meta, blob);
    set((s) => ({ assets: { ...s.assets, [meta.id]: meta } }));
  },
}));

// ---- 影像 URL 快取（整個工作階段共用，避免重複解碼） ----

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function assetUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return Promise.resolve(hit);
  const p = pending.get(id);
  if (p) return p;
  const job = db.getBlob(id).then((b) => {
    pending.delete(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urlCache.set(id, u);
    return u;
  });
  pending.set(id, job);
  return job;
}

export function useAssetUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(
    id ? urlCache.get(id) ?? null : null,
  );
  React.useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    assetUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

export async function assetBlob(id: string): Promise<Blob | null> {
  return db.getBlob(id);
}

export function useRenderProject(id: string): RenderProject | undefined {
  return useRenderStore((s) => s.projects[id]);
}
