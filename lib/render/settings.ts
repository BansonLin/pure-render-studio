"use client";

import * as React from "react";
import type { ModelOption } from "./provider";

/**
 * 裝置設定（API 金鑰、模型、上限）。
 *
 * 刻意只存在這台裝置的 localStorage，不進 IndexedDB 專案資料：
 * - 專案備份、交付包都讀 IndexedDB，金鑰因此不會跟著檔案流出
 * - 伺服器沒有資料庫可安全保存金鑰；呼叫一律由瀏覽器直接送到供應商，金鑰不經過璞石伺服器
 * 代價：每台裝置要各自輸入一次；清除網站資料會一起清掉。
 */

export type OpenAIQuality = "medium" | "high";
export type ClaudeEffort = "medium" | "high" | "xhigh";

export interface DeviceSettings {
  openai: { key: string; model: string; models: ModelOption[]; quality: OpenAIQuality; monthlyCap: number | null };
  claude: { key: string; model: string; models: ModelOption[]; effort: ClaudeEffort };
  /** 核准者姓名，讓核准時用選的不用打字 */
  approvers: string[];
}

export interface DeviceUsage {
  month: string;
  openaiImages: number;
  claudeReviews: number;
}

const SETTINGS_KEY = "prs.device-settings.v1";
const USAGE_KEY = "prs.device-usage.v1";
const EVENT = "prs-settings-change";

export const DEFAULT_SETTINGS: DeviceSettings = {
  openai: { key: "", model: "", models: [], quality: "high", monthlyCap: 50 },
  claude: { key: "", model: "", models: [], effort: "high" },
  approvers: [],
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("這個瀏覽器無法儲存設定（可能是私密瀏覽模式）。");
  }
  window.dispatchEvent(new Event(EVENT));
}

export function readSettings(): DeviceSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const s = read(SETTINGS_KEY, DEFAULT_SETTINGS);
  // 巢狀物件逐層補預設值，舊版設定缺欄位也能用
  return {
    openai: { ...DEFAULT_SETTINGS.openai, ...s.openai },
    claude: { ...DEFAULT_SETTINGS.claude, ...s.claude },
    approvers: Array.isArray(s.approvers) ? s.approvers : [],
  };
}

export function updateSettings(fn: (s: DeviceSettings) => void) {
  const s = readSettings();
  fn(s);
  write(SETTINGS_KEY, s);
}

export function readUsage(): DeviceUsage {
  const empty = { month: thisMonth(), openaiImages: 0, claudeReviews: 0 };
  if (typeof window === "undefined") return empty;
  const u = read(USAGE_KEY, empty);
  return u.month === thisMonth() ? u : empty;
}

export function bumpUsage(field: "openaiImages" | "claudeReviews") {
  const u = readUsage();
  u[field] += 1;
  write(USAGE_KEY, u);
}

/** 送出前檢查本裝置每月上限；成功與結果未知都計入，明確被拒的不算 */
export function assertOpenAIQuota() {
  const cap = readSettings().openai.monthlyCap;
  const used = readUsage().openaiImages;
  if (cap !== null && used >= cap) {
    throw new Error(`本裝置本月已用 ${used} 張，達到上限 ${cap} 張。要提高請到「設定」調整。`);
  }
}

export function rememberApprover(name: string) {
  const n = name.trim();
  if (!n) return;
  updateSettings((s) => {
    s.approvers = [n, ...s.approvers.filter((x) => x !== n)].slice(0, 8);
  });
}

export function maskKey(key: string) {
  if (!key) return "";
  return key.length <= 10 ? "••••" : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  // 另一個分頁改了設定時同步
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// useSyncExternalStore 需要穩定快照：以原始字串比對，內容沒變就回傳同一個物件
let settingsCache: { raw: string | null; value: DeviceSettings } | null = null;
let usageCache: { raw: string | null; value: DeviceUsage } | null = null;

function settingsSnapshot(): DeviceSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {}
  if (!settingsCache || settingsCache.raw !== raw) settingsCache = { raw, value: readSettings() };
  return settingsCache.value;
}

function usageSnapshot(): DeviceUsage {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(USAGE_KEY);
  } catch {}
  const key = `${raw}|${thisMonth()}`;
  if (!usageCache || usageCache.raw !== key) usageCache = { raw: key, value: readUsage() };
  return usageCache.value;
}

export function useDeviceSettings(): DeviceSettings {
  return React.useSyncExternalStore(subscribe, settingsSnapshot, () => DEFAULT_SETTINGS);
}

export function useDeviceUsage(): DeviceUsage {
  return React.useSyncExternalStore(subscribe, usageSnapshot, () => ({ month: "", openaiImages: 0, claudeReviews: 0 }));
}
