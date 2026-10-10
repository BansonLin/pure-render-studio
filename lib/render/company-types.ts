/**
 * 公司設定（後台）在瀏覽器與伺服器之間共用的型別與預設值。
 * 這個檔案不可引用任何伺服器模組：瀏覽器端也會載入。
 */

export interface ModelOption {
  id: string;
  label: string;
  note?: string;
  recommended?: boolean;
}

/** 空間預設：startNo 有值時，該空間的圖號從這個數字往上自動編 */
export interface RoomPreset {
  name: string;
  startNo: number | null;
}

export type OpenAIQuality = "medium" | "high";
export type ClaudeEffort = "medium" | "high" | "xhigh";

/** 給瀏覽器看的設定：只有金鑰末四碼，永遠不含金鑰本身 */
export interface PublicProvider<Extra> {
  configured: boolean;
  /** stored＝後台設定；env＝Vercel 環境變數；none＝未設定 */
  source: "stored" | "env" | "none";
  last4: string;
  setAt: string | null;
  setBy: string | null;
  model: string;
  models: ModelOption[];
  monthlyCap: number | null;
  extra: Extra;
}

export interface MonthUsage {
  month: string;
  openaiImages: number;
  claudeReviews: number;
  byUser: Record<string, { openaiImages: number; claudeReviews: number }>;
}

export interface PublicSettings {
  storeReady: boolean;
  isAdmin: boolean;
  email: string;
  openai: PublicProvider<{ quality: OpenAIQuality }>;
  claude: PublicProvider<{ effort: ClaudeEffort }>;
  rooms: RoomPreset[];
  usage: MonthUsage;
}

/** 預設空間與圖號區段【示意】：每個主要空間 10 號一段，管理者可在設定頁改成公司慣用編號 */
export const DEFAULT_ROOMS: RoomPreset[] = [
  { name: "玄關", startNo: 10 },
  { name: "客廳", startNo: 20 },
  { name: "餐廳", startNo: 30 },
  { name: "廚房", startNo: 40 },
  { name: "主臥", startNo: 50 },
  { name: "主臥衛浴", startNo: 60 },
  { name: "次臥", startNo: 70 },
  { name: "小孩房", startNo: 80 },
  { name: "書房", startNo: 90 },
  { name: "客衛", startNo: 100 },
  { name: "更衣室", startNo: 110 },
  { name: "陽台", startNo: 120 },
  { name: "客餐廳", startNo: null },
  { name: "餐廚", startNo: null },
  { name: "長輩房", startNo: null },
  { name: "和室", startNo: null },
  { name: "起居室", startNo: null },
  { name: "走道", startNo: null },
  { name: "樓梯", startNo: null },
  { name: "公設", startNo: null },
];

/**
 * 依空間預設建議圖號（未使用的前幾個）。
 * 有起始號：從起始號往上找空號；沒有：接在目前最大的數字之後。
 */
export function suggestViewNumbers(existingIds: string[], room: string, rooms: RoomPreset[], count = 5): string[] {
  const used = new Set(existingIds);
  const out: string[] = [];
  const preset = rooms.find((r) => r.name === room);
  let n: number;
  if (preset && preset.startNo !== null) {
    n = preset.startNo;
  } else {
    const nums = existingIds.map(Number).filter((x) => Number.isFinite(x));
    n = nums.length ? Math.max(...nums) + 1 : 1;
  }
  for (let guard = 0; out.length < count && guard < 10000; guard++, n++) {
    if (!used.has(String(n))) out.push(String(n));
  }
  return out;
}
