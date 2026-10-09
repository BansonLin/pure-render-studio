import type { RenderProject, SceneObject, Visibility } from "./types";

/**
 * 示範專案：中道森活一樓（結構範本）。
 *
 * 依「協作報告_20261009 / scene_contract.json」（v4 重建規格）建立四個視角、
 * 主圖依賴與場景物件聖經。這是「重建規格」，不是業主定案或施工尺寸。
 * 本範本「不含任何圖檔」——客戶案圖不進版控，請在畫布上拖入原圖。
 */

type V = Record<string, Visibility>;
const vis = (v20: Visibility, v33: Visibility, v29: Visibility, v34: Visibility): V => ({
  "20": v20,
  "33": v33,
  "29": v29,
  "34": v34,
});

const OBJECTS: SceneObject[] = [
  {
    id: "obj_cabinet",
    name: "餐邊櫃",
    category: "cabinet",
    spec: "淡橡木背板＋框、兩片薄米白層板形成三層；上層冰箱側約 1/3 一道短隔板；上方白封板與廚具封板同平面連續。下方一排淺抽＋兩片無把手橡木門。保留原窄櫃外廓，不加寬。",
    promptSpec:
      "Narrow display cabinet beside the fridge, keep its current narrow footprint: pale oak back panel and frame, TWO thin ivory horizontal shelf boards forming THREE open tiers, one short vertical divider ONLY in the top tier at the fridge-side one-third. Flush white kitchen upper fascia continues across the cabinet top (no open box above). One shallow handleless ivory drawer row and two handleless pale-oak doors below.",
    count: 1,
    anchor: "冰箱旁既有窄櫃位置",
    referenceAssetId: null,
    views: vis("visible", "hidden", "partial", "visible"),
    locked: true,
  },
  {
    id: "obj_cabinet_props",
    name: "餐邊櫃擺件",
    category: "prop",
    spec: "上層冰箱側：白圓瓶置兩本書上；上層另一格：短垂綠蘿米白盆；中層：三本奶油色書平疊靠冰箱側；下層淨空。",
    promptSpec:
      "Cabinet decor: small white bulb vase standing on two cream books in the fridge-side top niche; compact pothos in an ivory pot with short trails in the other top niche; exactly three cream books stacked flat in the middle tier near the fridge side; lowest display tier empty.",
    count: null,
    anchor: "餐邊櫃層板（依層位，不依畫面左右）",
    referenceAssetId: null,
    views: vis("visible", "hidden", "partial", "partial"),
    locked: true,
  },
  {
    id: "obj_pendant",
    name: "中島花瓣吊燈",
    category: "lighting",
    spec: "三層奶油色亞麻感花瓣燈罩、單一黑色吊線、小型中性圓形吊頂座；沿用原吊燈中心、尺度與高度。白天柔光不過曝。",
    promptSpec:
      "Sculptural three-layer cream linen petal pendant, thin soft undulating petals, suspended by ONE black cord with a small neutral round canopy, at the existing pendant point with the existing scale and drop height. Daytime: restrained soft glow, never overexposed.",
    count: 1,
    anchor: "原吊燈中心點（中島／餐桌上方）",
    referenceAssetId: null,
    views: vis("visible", "hidden", "unknown", "visible"),
    locked: true,
  },
  {
    id: "obj_dining",
    name: "餐桌椅與餐具",
    category: "furniture",
    spec: "保留原圓角桌面與單根肋紋柱腳；三張弧背實木椅＋米白素面布墊；三份餐具（奶油盤、碗、透明水杯、燕麥色素布巾）；牆端一只米白圓瓶插五枝橄欖枝。",
    promptSpec:
      "Rounded dining table with the original single fluted pedestal; exactly 3 curved solid-oak armchairs with plain ivory upholstered seats; exactly 3 place settings (cream plate, cream bowl, clear water glass, plain oatmeal napkin each); one ivory round vase with five olive branches at the WALL end of the table.",
    count: 3,
    anchor: "餐桌（花瓶靠牆端）",
    referenceAssetId: null,
    views: vis("visible", "hidden", "partial", "visible"),
    locked: true,
  },
  {
    id: "obj_island",
    name: "中島與吧椅",
    category: "furniture",
    spec: "兩張原木吧椅；小盤三顆綠梨＋素色亞麻布。不改中島尺寸位置。",
    promptSpec:
      "Kitchen island unchanged in size and position, 2 original wooden bar stools, one small plate with exactly three green pears and one plain linen towel.",
    count: 2,
    anchor: "中島檯面",
    referenceAssetId: null,
    views: vis("visible", "hidden", "hidden", "partial"),
    locked: true,
  },
  {
    id: "obj_sofa",
    name: "沙發與靠枕",
    category: "furniture",
    spec: "保留沙發、單椅原輪廓縫線比例；素面米白棉絨。靠枕三個：一米白方枕、一大橄欖枕、一橄欖腰枕；餐廚端一條燕麥色披毯。",
    promptSpec:
      "Keep the exact sofa and round armchair outlines, seams and proportions; smooth plain ivory cotton-velvet upholstery with no visible decorative grain. Exactly 3 cushions: one ivory square, one large muted-olive, one small olive lumbar at the window end. One plain oatmeal throw with broad folds at the DINING end.",
    count: 3,
    anchor: "沙發（披毯在餐廚端、腰枕在前窗端）",
    referenceAssetId: null,
    views: vis("hidden", "visible", "partial", "visible"),
    locked: true,
  },
  {
    id: "obj_coffee",
    name: "茶几與擺件",
    category: "prop",
    spec: "米白高茶几＋深炭低茶几維持原輪廓重疊。米白茶几：靠餐廚端一只低圓霧面米白陶瓶插五枝橄欖枝；靠前窗端兩本米白書平疊，書上一只小深色碗。不得增加其他擺件。",
    promptSpec:
      "Two nesting organic coffee tables (plain honed ivory high one, plain charcoal low one) with unchanged outlines and overlap. On the ivory table: exactly ONE low round matte ivory vase with five olive branches at the DINING end; exactly TWO cream books stacked flat at the WINDOW end with ONE small dark bowl on top of the stack. No other props.",
    count: null,
    anchor: "茶几（花瓶靠餐廚端、書碗靠前窗端）",
    referenceAssetId: null,
    views: vis("hidden", "visible", "visible", "visible"),
    locked: true,
  },
  {
    id: "obj_tv_shelf",
    name: "電視層板擺件",
    category: "prop",
    spec: "沿用原白色薄層架；上層一只小米白瓶、中層兩本奶油書平疊、下層一只無高腳深色淺碗；電視低櫃檯面淨空。",
    promptSpec:
      "White TV display shelves unchanged: exactly one small ivory vase on the top shelf, exactly two cream books stacked flat on the middle shelf, one low dark ceramic bowl WITHOUT pedestal on the bottom shelf. Low TV cabinet top stays empty.",
    count: null,
    anchor: "電視牆層板（依層位）",
    referenceAssetId: null,
    views: vis("hidden", "hidden", "visible", "partial"),
    locked: true,
  },
  {
    id: "obj_fern",
    name: "邊几蕨類",
    category: "plant",
    spec: "原胡桃木邊几（沙發與單椅之間）上一小盆羽葉腎蕨，霧面米色陶盆。看不到邊几的視角不得新增到別處。",
    promptSpec:
      "One small Boston fern in a matte beige ceramic pot on the original walnut side table between the sofa and the armchair. If the side table is hidden, do not place the fern elsewhere.",
    count: 1,
    anchor: "沙發與單椅之間的邊几",
    referenceAssetId: null,
    views: vis("hidden", "visible", "hidden", "visible"),
    locked: true,
  },
  {
    id: "obj_walls",
    name: "特殊塗料牆",
    category: "surface",
    spec: "沙發背牆（窗簾至第一道垂直燈槽）與電視弧牆：暖淺灰米色細緻霧面礦物塗料，僅寬幅輕微色階；無旋渦、紋路、水波。門區回折牆、天花、白層架沿用原色。",
    promptSpec:
      "Sofa rear wall (from curtain to the first vertical light slot) and the curved TV feature wall with returns: very fine matte warm light-greige mineral plaster, smooth at camera distance with only broad subtle tonal depth; no swirls, veins, ripples or bumps. Door wall, ceilings and white shelves keep the existing ivory paint.",
    count: null,
    anchor: "沙發背牆、電視弧牆",
    referenceAssetId: null,
    views: vis("hidden", "visible", "visible", "visible"),
    locked: true,
  },
  {
    id: "obj_soft_surfaces",
    name: "地毯、窗簾、地磚",
    category: "textile",
    spec: "地毯：素面沙米色霧面氈，相同矩形邊界；窗簾：素面米白薄紗＋暖灰米布簾，只有直向大褶；地磚：均勻暖米白霧面瓷磚，保留原直線勾縫。",
    promptSpec:
      "Rug: SOLID MATTE SAND-BEIGE FELT, completely featureless at this camera distance, same rectangular footprint. Curtains: plain sheer ivory voile and warm greige drapes with only natural broad vertical folds. Floor: uniform warm-ivory matte porcelain keeping the unchanged straight grout lines and perspective.",
    count: null,
    anchor: "全場景",
    referenceAssetId: null,
    views: vis("partial", "visible", "visible", "visible"),
    locked: true,
  },
];

export function zhongdaoSeed(now: string, id: string): RenderProject {
  return {
    id,
    code: "ZD-F1",
    name: "中道森活 一樓樣品屋",
    floor: "1F",
    createdAt: now,
    updatedAt: now,
    styleBrief:
      "住宅雜誌攝影質感：暖白、淺木、橄欖綠；自然窗光為主光、嵌燈白天關閉；陶器綠枝、亞麻織品與抽象掛畫。（v1 由助理提案、經四輪修正，非業主逐項定案）",
    views: [
      {
        id: "20",
        name: "餐廚斜景",
        room: "餐廚",
        role: "master",
        dependsOn: [],
        originalAssetId: null,
        acceptedVersionId: null,
        canvas: { x: 80, y: 80 },
        notes: "餐廚主圖：固定餐邊櫃、花瓣吊燈、餐桌椅擺件。",
      },
      {
        id: "33",
        name: "客廳正景",
        room: "客廳",
        role: "master",
        dependsOn: [],
        originalAssetId: null,
        acceptedVersionId: null,
        canvas: { x: 80, y: 300 },
        notes: "客廳主圖：固定沙發背牆塗料、織品、茶几擺件。",
      },
      {
        id: "29",
        name: "電視牆正景",
        room: "客廳",
        role: "derived",
        dependsOn: ["20", "33"],
        originalAssetId: null,
        acceptedVersionId: null,
        canvas: { x: 80, y: 520 },
        notes: "衍生：以自身原圖為幾何依據，主圖只供物件與材質。",
      },
      {
        id: "34",
        name: "客廳望餐廚",
        room: "客餐廳",
        role: "derived",
        dependsOn: ["20", "33"],
        originalAssetId: null,
        acceptedVersionId: null,
        canvas: { x: 80, y: 740 },
        notes: "衍生：同時含客廳與餐廚，最能檢驗跨圖一致性。",
      },
    ],
    versions: [],
    references: [],
    sceneObjects: OBJECTS,
    panoramas: [],
    repairLimit: 2,
    referenceBoard: { x: 1500, y: 80 },
  };
}

export function blankProject(
  now: string,
  id: string,
  fields: { code: string; name: string; floor: string },
): RenderProject {
  return {
    id,
    code: fields.code,
    name: fields.name,
    floor: fields.floor,
    createdAt: now,
    updatedAt: now,
    styleBrief: "",
    views: [],
    versions: [],
    references: [],
    sceneObjects: [],
    panoramas: [],
    repairLimit: 2,
    referenceBoard: { x: 1500, y: 80 },
  };
}
