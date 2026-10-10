"use client";

import * as React from "react";

/**
 * 本裝置的小偏好（目前只有核准者姓名）。API 金鑰與公司設定在後台，見 company.ts。
 */

interface DeviceSettings {
  /** 核准者姓名，讓核准時用選的不用打字 */
  approvers: string[];
}

const SETTINGS_KEY = "prs.device-settings.v1";
const EVENT = "prs-settings-change";
const DEFAULT_SETTINGS: DeviceSettings = { approvers: [] };

export function readSettings(): DeviceSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<DeviceSettings> & Record<string, unknown>;
    return { approvers: Array.isArray(raw.approvers) ? raw.approvers : [] };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function rememberApprover(name: string) {
  const n = name.trim();
  if (!n) return;
  const s = readSettings();
  s.approvers = [n, ...s.approvers.filter((x) => x !== n)].slice(0, 8);
  try {
    // 只寫核准者；舊版曾把金鑰存在這裡，覆寫時順便清掉
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    localStorage.removeItem("prs.device-usage.v1");
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

let snap: { raw: string | null; value: DeviceSettings } | null = null;
function snapshot(): DeviceSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {}
  if (!snap || snap.raw !== raw) snap = { raw, value: readSettings() };
  return snap.value;
}

export function useDeviceSettings(): DeviceSettings {
  return React.useSyncExternalStore(subscribe, snapshot, () => DEFAULT_SETTINGS);
}
