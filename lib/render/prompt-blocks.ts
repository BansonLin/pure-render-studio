/**
 * 提示詞積木庫。
 *
 * 每塊積木 = 一段經中道森活四輪驗證、可被檢查的指令。
 * 文字給模型用英文（影像模型對英文約束遵循度較高），標籤與說明給設計師用中文。
 *
 * 關鍵教訓：
 * - 「去除水波紋」這種抽象指令效果差；改成「把整個表面替換成指定素面材質，只留大範圍光影」才有效。
 * - 不可用「降噪 / 模糊」掩蓋，要求重建乾淨材質並保留銳利邊緣。
 */

export type BlockCategory =
  | "preserve"
  | "surface"
  | "lighting"
  | "consistency"
  | "style"
  | "output";

export const BLOCK_CATEGORY_LABEL: Record<BlockCategory, string> = {
  preserve: "保留鎖定",
  surface: "素面材質（去紋）",
  lighting: "光線",
  consistency: "跨視角一致",
  style: "風格",
  output: "輸出規範",
};

export interface PromptBlock {
  id: string;
  category: BlockCategory;
  label: string;
  hint: string;
  text: string;
  /** 新版本預設勾選 */
  defaultOn: boolean;
  /** 可作為選區積木（套在單一區域） */
  regional: boolean;
}

export const PROMPT_BLOCKS: PromptBlock[] = [
  // ---- 保留鎖定 ----
  {
    id: "keep-geometry",
    category: "preserve",
    label: "鎖定空間與鏡位",
    hint: "相機、透視、房間長寬高、門窗、樓梯、天花、地磚格線、家具佔地全部不動。",
    text: "Keep image 1's exact camera, framing, lens perspective, room length/width/height, walls and corners, doors, windows, stairs and handrails, ceiling height, vents, light apertures and slots, floor level changes and the straight floor grout grid. Keep every furniture footprint, outline and position. No enlargement, no new opening, no new architectural element.",
    defaultOn: true,
    regional: false,
  },
  {
    id: "keep-cabinet-ratio",
    category: "preserve",
    label: "櫃體只微調比例",
    hint: "可微調櫃體分割比例，但外廓、位置與空間尺寸不得改變。",
    text: "Cabinet proportions may only be refined INSIDE their existing outer footprint; never widen, deepen or move a cabinet, never change the room size.",
    defaultOn: false,
    regional: true,
  },
  {
    id: "keep-props",
    category: "preserve",
    label: "不增減擺件",
    hint: "未列在本輪修改的擺件一律不新增、不刪除、不換款。",
    text: "Do not add, remove, duplicate, recolor or restyle any decor object that is not explicitly listed in this round's changes.",
    defaultOn: true,
    regional: false,
  },
  {
    id: "keep-outside",
    category: "preserve",
    label: "選區外保持原樣",
    hint: "只改選區；選區外最後會由系統回貼原像素。",
    text: "Change ONLY the marked regions. Everything outside them must remain identical to image 1 — same pixels, colors, light and texture.",
    defaultOn: true,
    regional: false,
  },

  // ---- 素面材質（去水波紋）----
  {
    id: "surf-upholstery",
    category: "surface",
    label: "沙發布面 → 素面棉絨",
    hint: "替換整個布面材質，不是修圖去紋。保留縫線、輪廓、自然褶。",
    text: "Replace the ENTIRE upholstery with a newly manufactured material: SMOOTH, PLAIN, UNPATTERNED IVORY COTTON VELVET, like a solid flat cream fabric swatch, no visible grain at this camera distance. Old embossed, rippled or maze-like lines must disappear completely. Keep every seam, outline, cushion shape and the broad soft light gradients.",
    defaultOn: false,
    regional: true,
  },
  {
    id: "surf-rug",
    category: "surface",
    label: "地毯 → 素面氈",
    hint: "v4 驗證有效：羊毛描述仍會長紋，改『完全無紋素色氈』。",
    text: "Replace the ENTIRE rug with SOLID MATTE SAND-BEIGE FELT, completely featureless and smooth at this camera distance: zero weave, zero pile lines, zero loops, zero engravings, zero mazes, zero water ripples, zero decorative design. Include every exposed corner and the areas under and between tables. Keep the exact footprint, edge thickness, perspective and occlusions; only broad window light and object shadows remain.",
    defaultOn: false,
    regional: true,
  },
  {
    id: "surf-curtain",
    category: "surface",
    label: "窗簾 → 素面薄紗",
    hint: "只留自然直向大褶，無蕾絲、波紋干涉。",
    text: "Curtains become plain sheer ivory voile and plain warm-greige drapes with ONLY natural broad vertical folds; no lace, no moiré, no wavy interference, no cracked or rippled texture.",
    defaultOn: false,
    regional: true,
  },
  {
    id: "surf-floor",
    category: "surface",
    label: "地磚 → 素面霧面瓷磚",
    hint: "保留原直線勾縫與透視，去掉石紋、波紋。",
    text: "Floor becomes uniform warm-ivory matte porcelain tile with ONLY the unchanged straight grout lines and perspective plus sunlight shadows; no stone veins, no ripples, no cracks.",
    defaultOn: false,
    regional: true,
  },
  {
    id: "surf-plaster",
    category: "surface",
    label: "牆面 → 細緻礦物塗料",
    hint: "特殊塗料只能低對比細微變化，不可旋渦或雕刻紋。",
    text: "Wall finish: very fine matte warm light-greige mineral plaster, smooth at camera distance with only broad subtle tonal depth; no swirled trowel marks, no veins, no ripples, no bumps.",
    defaultOn: false,
    regional: true,
  },
  {
    id: "surf-wood",
    category: "surface",
    label: "木紋 → 細直紋",
    hint: "避免蟲形年輪、波浪木紋。",
    text: "Wood shows fine straight oak grain only; no worm-like growth rings, no wavy grain.",
    defaultOn: false,
    regional: true,
  },
  {
    id: "surf-corners",
    category: "surface",
    label: "四角與縫隙一併處理",
    hint: "角落與家具間露出的窄條地面最容易殘留。",
    text: "Apply the material replacement across the whole surface INCLUDING the extreme image corners and the narrow strips visible between furniture.",
    defaultOn: true,
    regional: false,
  },
  {
    id: "surf-no-blur",
    category: "surface",
    label: "重建材質、不用模糊",
    hint: "要求重建乾淨材質，禁止以模糊掩蓋。",
    text: "Rebuild clean material appearance; do NOT apply a blur or denoise filter. Keep crisp furniture edges, seams and contact shadows.",
    defaultOn: true,
    regional: false,
  },

  // ---- 光線 ----
  {
    id: "light-daylight",
    category: "lighting",
    label: "自然窗光",
    hint: "日光只從既有窗戶進入，柔和陰影、暖中性白平衡。",
    text: "Natural daylight enters ONLY through the existing windows, with the same direction for this camera, soft realistic shadows and a warm-neutral white balance. Whites stay neutral, not orange.",
    defaultOn: true,
    regional: false,
  },
  {
    id: "light-downlights-off",
    category: "lighting",
    label: "嵌燈白天關閉",
    hint: "v3 回饋：嵌燈太亮。灰色內孔、無亮點光暈。",
    text: "Recessed ceiling downlights are OFF in daytime: grey inner aperture and matte white ring, no hotspot, no orange glow, no beam, no halo.",
    defaultOn: true,
    regional: false,
  },
  {
    id: "light-indirect-soft",
    category: "lighting",
    label: "保留既有間接光",
    hint: "只保留原有燈槽／層板柔光，不新增燈帶。",
    text: "Keep only the existing light slots and shelf lighting as a soft restrained glow; do not invent new light strips, coves or fixtures.",
    defaultOn: false,
    regional: false,
  },

  // ---- 跨視角一致 ----
  {
    id: "cons-one-house",
    category: "consistency",
    label: "同一個家",
    hint: "所有參考圖是同一間房子的不同鏡位，只借指定物件。",
    text: "All images depict ONE identical house seen from different cameras. Copy only the objects and materials named for each reference image; never borrow a reference image's camera, framing or room proportions.",
    defaultOn: true,
    regional: false,
  },
  {
    id: "cons-world-space",
    category: "consistency",
    label: "以空間方位對位",
    hint: "物件位置用「靠餐廚端／靠前窗端」，不是畫面左右。",
    text: "Match object placement in WORLD space using the named spatial anchors (e.g. dining end, window end), never by image-space left/right.",
    defaultOn: true,
    regional: false,
  },
  {
    id: "cons-counts",
    category: "consistency",
    label: "數量是全場景數量",
    hint: "被遮擋或在畫外的不硬塞進畫面；看得到的不可多也不可少。",
    text: "Object counts are scene-wide totals. Respect occlusion: never force a hidden or out-of-frame object into view, and never duplicate a visible one.",
    defaultOn: true,
    regional: false,
  },

  // ---- 風格 ----
  {
    id: "style-magazine",
    category: "style",
    label: "雜誌攝影質感",
    hint: "克制的室內攝影語言，不加人物、暗角、誇張景觀。",
    text: "Restrained high-end interior magazine photography: realistic materials, clean verticals, soft highlights, natural contact shadows. No people, no vignette, no dramatic fake view.",
    defaultOn: true,
    regional: false,
  },

  // ---- 輸出 ----
  {
    id: "out-clean",
    category: "output",
    label: "單張乾淨輸出",
    hint: "同比例、無字、無浮水印、無框線箭頭。",
    text: "Output ONE single photograph with the same aspect ratio as image 1. No text, no watermark, no collage, no UI marks, no boxes, numbers or arrows.",
    defaultOn: true,
    regional: false,
  },
];

export const BLOCK_BY_ID: Record<string, PromptBlock> = Object.fromEntries(
  PROMPT_BLOCKS.map((b) => [b.id, b]),
);

export const DEFAULT_BLOCK_IDS = PROMPT_BLOCKS.filter((b) => b.defaultOn).map(
  (b) => b.id,
);

/** 一律附加的排除清單（四輪累積的實際瑕疵型態） */
export const REJECT_LIST =
  "water-ripple or embossed wave patterns, repeating maze lines, worm-like loops, moiré on fabrics or curtains, engraved rug lines, wavy wood grain, residual texture in image corners, new objects, duplicated objects, changed furniture shapes, glowing downlights, text or watermarks";
