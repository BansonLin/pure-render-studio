import type { RenderProject, Version, VersionState } from "./types";

/**
 * 版本狀態機（純函式）。
 * 核心規則：機器檢查通過 ≠ 人工核准；accepted 必須有核准者、時間與說明。
 */

export const STATE_LABEL: Record<VersionState, string> = {
  draft: "編輯中",
  submitted: "等待結果",
  outcome_unknown: "結果未知",
  qa_pending: "待檢查",
  repair_needed: "待修正",
  human_review_pending: "待核准",
  accepted: "已核准",
  rejected: "已退件",
  failed: "失敗",
  needs_revalidation: "需重驗",
};

export const STATE_TONE: Record<VersionState, "muted" | "info" | "warn" | "ok" | "bad"> = {
  draft: "muted",
  submitted: "info",
  outcome_unknown: "warn",
  qa_pending: "info",
  repair_needed: "warn",
  human_review_pending: "info",
  accepted: "ok",
  rejected: "bad",
  failed: "bad",
  needs_revalidation: "warn",
};

const ALLOWED: Record<VersionState, VersionState[]> = {
  draft: ["submitted", "qa_pending", "rejected"],
  submitted: ["qa_pending", "outcome_unknown", "failed", "draft"],
  outcome_unknown: ["qa_pending", "failed"],
  qa_pending: ["repair_needed", "human_review_pending", "rejected"],
  repair_needed: ["human_review_pending", "rejected", "qa_pending"],
  human_review_pending: ["accepted", "repair_needed", "rejected"],
  accepted: ["needs_revalidation", "rejected"],
  rejected: [],
  failed: ["draft"],
  needs_revalidation: ["qa_pending", "human_review_pending", "rejected"],
};

export function canTransition(from: VersionState, to: VersionState) {
  return ALLOWED[from].includes(to);
}

export function versionsOf(p: RenderProject, viewId: string): Version[] {
  return p.versions
    .filter((v) => v.viewId === viewId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function nextLabel(p: RenderProject, viewId: string) {
  return `v${versionsOf(p, viewId).length + 1}`;
}

/** 已用的定向修正次數：不是從原圖單跳的版本（不含退件） */
export function repairsUsed(p: RenderProject, viewId: string) {
  return versionsOf(p, viewId).filter(
    (v) => v.baseStrategy !== "original" && v.state !== "rejected" && v.state !== "draft",
  ).length;
}

/**
 * 世代深度：從原圖起算、未經選區回貼的全圖 AI 重生成次數。
 * 有選區且已回貼 → 不增加（選區外像素維持上一代）。
 */
export function childDepth(parentDepth: number, willComposite: boolean) {
  return willComposite ? parentDepth : parentDepth + 1;
}

/**
 * 主圖核准版本變更 → 釘選舊主圖的衍生版本標為需重驗。
 * 回傳受影響的版本 id。
 */
export function invalidateDependents(p: RenderProject, masterViewId: string): string[] {
  const master = p.views.find((v) => v.id === masterViewId);
  const acceptedId = master?.acceptedVersionId ?? null;
  const touched: string[] = [];
  for (const v of p.versions) {
    const pin = v.pinnedMasters.find((m) => m.viewId === masterViewId);
    if (!pin || pin.versionId === acceptedId) continue;
    if (["accepted", "human_review_pending", "qa_pending", "repair_needed"].includes(v.state)) {
      v.state = "needs_revalidation";
      v.events.push({
        at: new Date().toISOString(),
        type: "needs_revalidation",
        detail: `主圖 ${masterViewId} 已改為其他版本`,
      });
      touched.push(v.id);
    }
  }
  return touched;
}

export const DEFAULT_QA_CHECKS: { id: string; label: string }[] = [
  { id: "geometry", label: "鏡位、門窗、牆線、櫃體分割與原圖一致" },
  { id: "objects", label: "物件數量與場景契約一致（依遮擋判定）" },
  { id: "surfaces", label: "布面／地毯／窗簾／地磚無水波、迷宮紋" },
  { id: "corners", label: "四角與家具間窄縫無殘紋（原尺寸檢視）" },
  { id: "lighting", label: "嵌燈無亮點光暈，日光方向正確" },
  { id: "crossview", label: "與主圖同款燈具、櫃體、擺件（空間方位）" },
  { id: "regression", label: "先前通過項目無退步" },
];
