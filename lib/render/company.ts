"use client";

import * as React from "react";
import type { PublicSettings } from "./company-types";

/**
 * 瀏覽器端讀寫公司設定（後台）。整個分頁共用一份快取，任何地方改完都會同步。
 * 金鑰只送進 /api/settings/key，之後只會拿到末四碼。
 */

let cache: PublicSettings | null = null;
let inflight: Promise<PublicSettings> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new Error("連不到伺服器，請檢查網路。");
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `伺服器錯誤（${res.status}）`);
  return j;
}

function set(s: PublicSettings) {
  cache = s;
  emit();
}

export function refreshCompany(): Promise<PublicSettings> {
  inflight ??= call<PublicSettings>("/api/settings")
    .then((s) => {
      set(s);
      return s;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function patchCompany(body: unknown) {
  set(await call<PublicSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }));
}

export async function saveProviderKey(provider: "openai" | "claude", key?: string) {
  const r = await call<{ found: number; settings: PublicSettings }>("/api/settings/key", {
    method: "POST",
    body: JSON.stringify({ provider, key }),
  });
  set(r.settings);
  return r.found;
}

export async function clearProviderKey(provider: "openai" | "claude") {
  set(await call<PublicSettings>(`/api/settings/key?provider=${provider}`, { method: "DELETE" }));
}

export function useCompany(): { data: PublicSettings | null; error: string | null } {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    listeners.add(force);
    if (!cache) refreshCompany().catch((e: Error) => setError(e.message));
    return () => {
      listeners.delete(force);
    };
  }, []);
  return { data: cache, error };
}
