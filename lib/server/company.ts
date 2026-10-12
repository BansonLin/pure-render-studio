import {
  DEFAULT_ROOMS,
  type ClaudeEffort,
  type GoogleImageSize,
  type ModelOption,
  type MonthUsage,
  type OpenAIQuality,
  type PublicSettings,
  type RoomPreset,
  type UsageField,
} from "@/lib/render/company-types";
import { decryptSecret, encryptSecret } from "./crypto";
import { readJson, storeMode, updateJson } from "./store";

/**
 * 公司設定（後台）：API 金鑰（加密）、模型、月上限、空間與圖號預設。
 * 金鑰只在伺服器解密使用，任何回應都只給末四碼。
 */

interface StoredKey {
  enc: string;
  last4: string;
  setAt: string;
  setBy: string;
}

interface ProviderBlock<Extra> {
  key: StoredKey | null;
  model: string;
  models: ModelOption[];
  monthlyCap: number | null;
  extra: Extra;
}

export interface CompanySettings {
  version: 1;
  openai: ProviderBlock<{ quality: OpenAIQuality }>;
  google: ProviderBlock<{ size: GoogleImageSize }>;
  claude: ProviderBlock<{ effort: ClaudeEffort }>;
  rooms: RoomPreset[];
}

const SETTINGS_KEY = "settings/company.json";
const usageKey = (month: string) => `usage/${month}.json`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export const DEFAULT_COMPANY: CompanySettings = {
  version: 1,
  openai: { key: null, model: "", models: [], monthlyCap: 100, extra: { quality: "high" } },
  google: { key: null, model: "", models: [], monthlyCap: 100, extra: { size: "2K" } },
  claude: { key: null, model: "", models: [], monthlyCap: 300, extra: { effort: "high" } },
  rooms: DEFAULT_ROOMS,
};

function normalize(raw: Partial<CompanySettings>): CompanySettings {
  // 舊版或缺欄位的資料逐層補預設值，不因結構演進讀壞
  const d = DEFAULT_COMPANY;
  return {
    version: 1,
    openai: { ...d.openai, ...raw.openai, extra: { ...d.openai.extra, ...raw.openai?.extra } },
    google: { ...d.google, ...raw.google, extra: { ...d.google.extra, ...raw.google?.extra } },
    claude: { ...d.claude, ...raw.claude, extra: { ...d.claude.extra, ...raw.claude?.extra } },
    rooms: Array.isArray(raw.rooms) && raw.rooms.length ? raw.rooms : d.rooms,
  };
}

export async function loadCompany(): Promise<CompanySettings> {
  if (!storeMode()) return DEFAULT_COMPANY;
  const r = await readJson<Partial<CompanySettings>>(SETTINGS_KEY, {});
  return normalize(r.value);
}

export async function updateCompany(fn: (c: CompanySettings) => void): Promise<CompanySettings> {
  return updateJson<Partial<CompanySettings>>(SETTINGS_KEY, {}, (raw) => {
    const c = normalize(raw);
    fn(c);
    return c;
  }) as Promise<CompanySettings>;
}

export function sealKey(plain: string, by: string): StoredKey {
  return { enc: encryptSecret(plain), last4: plain.slice(-4), setAt: new Date().toISOString(), setBy: by };
}

// ---- 用量與上限（全公司共用，伺服器端計算） ----

const emptyUsage = (month: string): MonthUsage => ({ month, openaiImages: 0, googleImages: 0, claudeReviews: 0, byUser: {} });

/** 舊月份檔案沒有後來新增的計數欄位，讀進來一律補 0 */
function normalizeUsage(u: MonthUsage): MonthUsage {
  const n = (x: unknown) => (typeof x === "number" ? x : 0);
  const byUser: MonthUsage["byUser"] = {};
  for (const [email, w] of Object.entries(u.byUser ?? {})) {
    byUser[email] = { openaiImages: n(w?.openaiImages), googleImages: n(w?.googleImages), claudeReviews: n(w?.claudeReviews) };
  }
  return { month: u.month, openaiImages: n(u.openaiImages), googleImages: n(u.googleImages), claudeReviews: n(u.claudeReviews), byUser };
}

export async function loadUsage(): Promise<MonthUsage> {
  const m = thisMonth();
  if (!storeMode()) return emptyUsage(m);
  return normalizeUsage((await readJson<MonthUsage>(usageKey(m), emptyUsage(m))).value);
}

export async function bumpUsage(field: UsageField, email: string) {
  if (!storeMode()) return;
  const m = thisMonth();
  await updateJson<MonthUsage>(usageKey(m), emptyUsage(m), (raw) => {
    const u = normalizeUsage(raw);
    u[field] += 1;
    const who = (u.byUser[email] ??= { openaiImages: 0, googleImages: 0, claudeReviews: 0 });
    who[field] += 1;
    return u;
  });
}

const USAGE_LABEL: Record<UsageField, (n: number) => string> = {
  openaiImages: (n) => `OpenAI 出圖 ${n} 張`,
  googleImages: (n) => `Google 出圖 ${n} 張`,
  claudeReviews: (n) => `Claude ${n} 次`,
};

export async function assertUnderCap(field: UsageField, cap: number | null) {
  if (cap === null) return;
  const u = await loadUsage();
  if (u[field] >= cap) {
    const what = USAGE_LABEL[field](u[field]);
    throw new CapReachedError(`本月全公司已用 ${what}，達到上限 ${cap}。請管理者到「設定」調整。`);
  }
}

export class CapReachedError extends Error {}

// ---- 取得可用金鑰：後台優先，其次 Vercel 環境變數 ----

/** 換過 AUTH_SECRET 時舊密文解不開；回成可讀訊息，不讓路由丟 500 */
function openSecret(enc: string): string | null {
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}
const UNREADABLE = "後台金鑰無法解密（可能更換過 AUTH_SECRET），請管理者到「設定」重新輸入。";

export async function resolveOpenAI(): Promise<{ key: string; model: string; quality: OpenAIQuality; cap: number | null } | { error: string }> {
  const c = await loadCompany();
  if (c.openai.key && c.openai.model) {
    const key = openSecret(c.openai.key.enc);
    if (!key) return { error: UNREADABLE };
    return { key, model: c.openai.model, quality: c.openai.extra.quality, cap: c.openai.monthlyCap };
  }
  // 舊做法：在 Vercel 設環境變數；保留以免既有設定失效
  if (process.env.RENDER_LIVE === "1" && process.env.OPENAI_API_KEY && process.env.OPENAI_IMAGE_MODEL) {
    return { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_IMAGE_MODEL, quality: "high", cap: c.openai.monthlyCap };
  }
  return { error: "尚未設定 OpenAI 金鑰，請管理者到「設定」輸入。" };
}

export async function resolveGoogle(): Promise<{ key: string; model: string; size: GoogleImageSize; cap: number | null } | { error: string }> {
  const c = await loadCompany();
  if (c.google.key && c.google.model) {
    const key = openSecret(c.google.key.enc);
    if (!key) return { error: UNREADABLE };
    return { key, model: c.google.model, size: c.google.extra.size, cap: c.google.monthlyCap };
  }
  return { error: "尚未設定 Google 金鑰，請管理者到「設定」輸入。" };
}

export async function resolveClaude(): Promise<{ key: string; model: string; effort: ClaudeEffort; cap: number | null } | { error: string }> {
  const c = await loadCompany();
  if (c.claude.key && c.claude.model) {
    const key = openSecret(c.claude.key.enc);
    if (!key) return { error: UNREADABLE };
    return { key, model: c.claude.model, effort: c.claude.extra.effort, cap: c.claude.monthlyCap };
  }
  return { error: "尚未設定 Claude 金鑰，請管理者到「設定」輸入。" };
}

export async function publicSettings(user: { email: string; isAdmin: boolean }): Promise<PublicSettings> {
  const ready = !!storeMode();
  const [c, usage] = await Promise.all([loadCompany(), loadUsage()]);
  const envOpenAI = process.env.RENDER_LIVE === "1" && !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_IMAGE_MODEL;
  return {
    storeReady: ready,
    isAdmin: user.isAdmin,
    email: user.email,
    openai: {
      configured: !!(c.openai.key && c.openai.model) || envOpenAI,
      source: c.openai.key ? "stored" : envOpenAI ? "env" : "none",
      last4: c.openai.key?.last4 ?? "",
      setAt: c.openai.key?.setAt ?? null,
      setBy: c.openai.key?.setBy ?? null,
      model: c.openai.key ? c.openai.model : envOpenAI ? process.env.OPENAI_IMAGE_MODEL! : "",
      models: c.openai.models,
      monthlyCap: c.openai.monthlyCap,
      extra: c.openai.extra,
    },
    google: {
      configured: !!(c.google.key && c.google.model),
      source: c.google.key ? "stored" : "none",
      last4: c.google.key?.last4 ?? "",
      setAt: c.google.key?.setAt ?? null,
      setBy: c.google.key?.setBy ?? null,
      model: c.google.model,
      models: c.google.models,
      monthlyCap: c.google.monthlyCap,
      extra: c.google.extra,
    },
    claude: {
      configured: !!(c.claude.key && c.claude.model),
      source: c.claude.key ? "stored" : "none",
      last4: c.claude.key?.last4 ?? "",
      setAt: c.claude.key?.setAt ?? null,
      setBy: c.claude.key?.setBy ?? null,
      model: c.claude.model,
      models: c.claude.models,
      monthlyCap: c.claude.monthlyCap,
      extra: c.claude.extra,
    },
    rooms: c.rooms,
    usage,
  };
}
