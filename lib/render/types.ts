// 璞石 Render Studio — 渲染優化工作台領域型別
//
// 設計原則（來自中道森活一樓四輪協作的教訓）：
// 1. 原圖唯讀；每次生成另存候選版本，不覆寫。
// 2. 「已生成 / 檢查中 / 待核准 / 已接受」分開記錄，機器檢查通過 ≠ 人工核准。
// 3. 跨視角物件以「場景物件」+ 參考裁切圖定義，不靠每次重寫文字描述。
// 4. 位置用空間語意（靠餐廚端、靠前窗端），不用畫面左右。

export type AssetKind =
  | "original" // 設計師 3D 原始出圖（幾何與鏡位依據）
  | "candidate" // AI 生成候選（含回貼合成後版本）
  | "reference" // 設計參考照片（材質、燈具、櫃體）
  | "object-crop" // 從已核准主圖裁出的物件參考
  | "mask" // 編輯遮罩
  | "pano-face" // 360 環景來源面
  | "pano"; // 縫合後的等距長方投影全景

export interface AssetMeta {
  id: string;
  projectId: string;
  kind: AssetKind;
  name: string;
  sha256: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  createdAt: string;
}

export type ViewRole = "master" | "derived" | "standalone";

export interface CanvasPos {
  x: number;
  y: number;
}

export interface RenderView {
  /** 視角編號，例如 "20" */
  id: string;
  name: string;
  /** 所屬空間：餐廚 / 客廳 / 主臥… */
  room: string;
  role: ViewRole;
  /** 衍生視角依賴的主圖視角 */
  dependsOn: string[];
  originalAssetId: string | null;
  acceptedVersionId: string | null;
  canvas: CanvasPos;
  notes: string;
}

/**
 * 本輪生成以哪張圖為編輯底圖。
 * - original：從設計師原圖單跳（預設，水波紋風險最低）
 * - accepted：從該視角已核准版本修正
 * - parent：從指定前一版修正（鏈式，需搭配選區回貼）
 */
export type BaseStrategy = "original" | "accepted" | "parent";

export type VersionState =
  | "draft" // 編輯中，尚未送出
  | "submitted" // 已送出 / 已匯出任務包，等待結果
  | "outcome_unknown" // 逾時或斷線，無法確認供應商結果（不可盲目重送）
  | "qa_pending" // 結果已匯入，待檢查
  | "repair_needed" // 有明確待修區域
  | "human_review_pending" // 待人工核准
  | "accepted" // 已核准（需核准者、時間、說明）
  | "rejected"
  | "failed"
  | "needs_revalidation"; // 依賴主圖或場景規格已變更

export type ReferenceRole =
  | "master-view" // 已核准主圖：只借物件／材質，不借鏡位
  | "object" // 物件參考：照抄造型、顏色、材質
  | "material" // 材質參考
  | "style" // 風格氛圍參考
  | "annotation"; // 標註示意圖（只供理解，不得畫出框線）

export const REFERENCE_ROLE_LABEL: Record<ReferenceRole, string> = {
  "master-view": "已核准主圖",
  object: "物件參考",
  material: "材質參考",
  style: "風格參考",
  annotation: "標註示意",
};

export interface ReferenceSlot {
  assetId: string;
  role: ReferenceRole;
  /** 這張參考圖「只」提供什麼（寫給模型） */
  note: string;
  /** 自動帶入的來源（主圖釘選／物件聖經），手動加入為 null */
  source: "pinned-master" | "scene-object" | "manual";
}

/** 以 0..1 正規化座標表示，與實際像素無關 */
export interface RectShape {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BrushShape {
  type: "brush";
  /** 每一筆畫的點列（正規化座標） */
  strokes: { x: number; y: number }[][];
  /** 筆刷半徑，以影像寬度比例表示 */
  radius: number;
}

export type RegionShape = RectShape | BrushShape;

export type RegionKind =
  | "edit" // 本輪要修改的範圍
  | "lock" // 明確鎖定不可變更
  | "object"; // 擺放／對齊場景物件（連結 SceneObject）

export interface Region {
  id: string;
  kind: RegionKind;
  shape: RegionShape;
  label: string;
  /** 使用者對此區的修改說明（原文） */
  instruction: string;
  objectId: string | null;
  /** 套用在此區的提示詞積木 */
  blockIds: string[];
}

export type QaVerdict = "pass" | "fail" | "uncertain" | "na";

export interface QaCheck {
  id: string;
  label: string;
  verdict: QaVerdict | null;
  note: string;
}

export interface RippleFinding {
  /** 正規化 bbox */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  where: string;
}

export interface RippleReport {
  comparedTo: "original" | "base" | "none";
  /** 疑似新增紋理面積比（0..1） */
  suspectRatio: number;
  /** 四角 15% 區域的最高分數 */
  cornerMax: number;
  findings: RippleFinding[];
  /** 每格分數（0..1），供熱圖 */
  grid: { cols: number; rows: number; scores: number[] };
  analyzedAt: string;
}

export interface QaRecord {
  ripple: RippleReport | null;
  checks: QaCheck[];
  alignment: { dx: number; dy: number; scale: number; residual: number; similarity: number } | null;
}

export interface Acceptance {
  by: string;
  at: string;
  note: string;
}

export interface VersionEvent {
  at: string;
  type: string;
  detail?: string;
}

export interface Version {
  id: string;
  viewId: string;
  /** v1、v2…（同視角流水號） */
  label: string;
  createdAt: string;
  baseStrategy: BaseStrategy;
  /** 實際作為編輯底圖的資產 */
  baseAssetId: string;
  parentVersionId: string | null;
  /** 從原圖算起，未經選區回貼的全圖 AI 重生成次數 */
  generationDepth: number;
  /** 使用者原文（不改寫） */
  rawRequest: string;
  regions: Region[];
  blockIds: string[];
  references: ReferenceSlot[];
  compiledPrompt: string;
  compilerVersion: string;
  /** 衍生視角送出時釘選的主圖版本與雜湊；主圖變更時據此判定需重驗 */
  pinnedMasters: { viewId: string; versionId: string; sha256: string }[];
  provider: "manual" | "openai";
  providerJobId: string | null;
  /** AI 原始輸出（未回貼） */
  rawResultAssetId: string | null;
  /** 最終候選（已回復原尺寸、可能已回貼選區外像素） */
  resultAssetId: string | null;
  composited: boolean;
  state: VersionState;
  qa: QaRecord | null;
  acceptance: Acceptance | null;
  events: VersionEvent[];
}

export type SceneCategory =
  | "lighting"
  | "furniture"
  | "cabinet"
  | "prop"
  | "textile"
  | "surface"
  | "plant";

export const SCENE_CATEGORY_LABEL: Record<SceneCategory, string> = {
  lighting: "燈具",
  furniture: "家具",
  cabinet: "櫃體",
  prop: "擺件",
  textile: "織品",
  surface: "面材",
  plant: "植栽",
};

export type Visibility = "visible" | "partial" | "hidden" | "unknown";

export interface SceneObject {
  id: string;
  name: string;
  category: SceneCategory;
  /** 中文規格（給人看） */
  spec: string;
  /** 英文規格（給模型） */
  promptSpec: string;
  /** 全場景數量；null 表示不適用 */
  count: number | null;
  /** 空間語意錨點，例如「茶几靠前窗端」 */
  anchor: string;
  referenceAssetId: string | null;
  views: Record<string, Visibility>;
  locked: boolean;
}

export interface ProjectReference {
  assetId: string;
  label: string;
  role: ReferenceRole;
}

export type PanoMode = "ring4" | "cube6" | "ringN" | "equirect";

export interface PanoFace {
  assetId: string | null;
  yaw: number;
  pitch: number;
  roll: number;
  label: string;
}

export interface Panorama {
  id: string;
  name: string;
  mode: PanoMode;
  hfov: number;
  faces: PanoFace[];
  resultAssetId: string | null;
  createdAt: string;
  notes: string;
}

export interface RenderProject {
  id: string;
  /** 案號（避免姓名與地址） */
  code: string;
  name: string;
  floor: string;
  createdAt: string;
  updatedAt: string;
  /** 全案風格方向（v1 確立後成為共用基準） */
  styleBrief: string;
  views: RenderView[];
  versions: Version[];
  references: ProjectReference[];
  sceneObjects: SceneObject[];
  panoramas: Panorama[];
  /** 修正上限（首次生成後的定向修正次數），依專案預算設定 */
  repairLimit: number;
  /** 參考畫布位置 */
  referenceBoard: CanvasPos;
}
