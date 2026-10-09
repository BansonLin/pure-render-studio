import { BLOCK_BY_ID, REJECT_LIST } from "./prompt-blocks";
import type {
  Region,
  RegionShape,
  RenderProject,
  RenderView,
  ReferenceSlot,
  SceneObject,
} from "./types";

/**
 * 提示詞編譯器（純函式）。
 *
 * 把「使用者原文 + 畫布標註 + 積木 + 場景物件聖經 + 參考圖角色」編成一份
 * 分段明確、可被檢查的提示詞。結構沿用一樓 v4 實際有效的四層：
 *   目標與參考角色 → 保留項 → 本輪修改 → 排除與驗收
 * 並加上場景契約（物件數量／空間錨點）。
 */

export const COMPILER_VERSION = "rc-1.0.0";

export interface CompileInput {
  project: Pick<RenderProject, "styleBrief" | "sceneObjects" | "views">;
  view: RenderView;
  rawRequest: string;
  regions: Region[];
  blockIds: string[];
  /** 依序為 Image 2、3…（Image 1 永遠是編輯底圖） */
  references: ReferenceSlot[];
  referenceLabels: Record<string, string>;
  /** 是否附上本視角全部可見場景物件（無選區時預設 true） */
  includeSceneContract: boolean;
  /** 供應商是否會收到真正的遮罩 */
  maskSupported: boolean;
}

export interface CompileOutput {
  prompt: string;
  summaryZh: string[];
}

/** aspect = 影像寬 / 高；筆刷半徑以寬度比例儲存，換算到高度需乘上比例 */
export function shapeBounds(
  shape: RegionShape,
  aspect = 16 / 9,
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (shape.type === "rect") {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const s of shape.strokes)
    for (const p of s) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  if (maxX < minX) return { x: 0, y: 0, w: 0, h: 0 };
  const r = shape.radius;
  const x = Math.max(0, minX - r);
  const y = Math.max(0, minY - r * aspect);
  return {
    x,
    y,
    w: Math.min(1, maxX + r) - x,
    h: Math.min(1, maxY + r * aspect) - y,
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 粗略方位描述，協助模型與人理解選區位置 */
export function describeArea(b: { x: number; y: number; w: number; h: number }) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const h = cx < 0.33 ? "left" : cx > 0.67 ? "right" : "center";
  const v = cy < 0.33 ? "upper" : cy > 0.67 ? "lower" : "middle";
  const en = v === "middle" && h === "center" ? "center" : `${v} ${h}`;
  const zhH = h === "left" ? "左" : h === "right" ? "右" : "中";
  const zhV = v === "upper" ? "上" : v === "lower" ? "下" : "中";
  return { en, zh: `畫面${zhV}${zhH}` };
}

function regionLine(r: Region, idx: number, objects: Map<string, SceneObject>) {
  const b = shapeBounds(r.shape);
  const area = describeArea(b);
  const box = `x ${pct(b.x)}–${pct(b.x + b.w)}, y ${pct(b.y)}–${pct(b.y + b.h)} of the frame (${area.en})`;
  const parts: string[] = [];
  const tag = r.kind === "lock" ? `L${idx}` : r.kind === "object" ? `O${idx}` : `E${idx}`;
  parts.push(`[${tag}] ${r.label || `${area.en} region`} — ${box}.`);
  if (r.kind === "object" && r.objectId) {
    const o = objects.get(r.objectId);
    if (o) parts.push(`Place / align: ${o.promptSpec} Spatial anchor: ${o.anchor}.`);
  }
  for (const id of r.blockIds) {
    const blk = BLOCK_BY_ID[id];
    if (blk) parts.push(blk.text);
  }
  if (r.instruction.trim()) {
    parts.push(`Designer instruction (zh-TW, follow literally): 「${r.instruction.trim()}」`);
  }
  return parts.join(" ");
}

export function compilePrompt(input: CompileInput): CompileOutput {
  const { project, view, regions, references } = input;
  const objects = new Map(project.sceneObjects.map((o) => [o.id, o]));
  const blocks = input.blockIds.map((id) => BLOCK_BY_ID[id]).filter(Boolean);
  const byCat = (c: string) => blocks.filter((b) => b.category === c).map((b) => b.text);

  const edits = regions.filter((r) => r.kind !== "lock");
  const locks = regions.filter((r) => r.kind === "lock");
  const lines: string[] = [];
  const zh: string[] = [];

  // 1) 目標與參考角色
  lines.push(
    `TASK: Edit ONE photorealistic interior architectural photograph. View ${view.id} (${view.room} · ${view.name}).`,
  );
  lines.push("");
  lines.push("IMAGE ROLES:");
  lines.push(
    "- Image 1 is the ONLY edit target and the sole authority for camera, framing, perspective, room dimensions, architecture and furniture footprints.",
  );
  references.forEach((ref, i) => {
    const n = i + 2;
    const label = input.referenceLabels[ref.assetId] ?? "reference";
    const note = ref.note.trim();
    switch (ref.role) {
      case "master-view":
        lines.push(
          `- Image ${n} = approved MASTER view "${label}" of the same house. Use it ONLY to copy: ${note || "the named objects and materials"}. Never borrow its camera or room proportions.`,
        );
        break;
      case "object":
        lines.push(
          `- Image ${n} = OBJECT reference "${label}". Reproduce its exact form, color, material and proportion${note ? ` (${note})` : ""}; do not copy its background or room.`,
        );
        break;
      case "material":
        lines.push(
          `- Image ${n} = MATERIAL reference "${label}". Copy only the surface material${note ? `: ${note}` : ""}; never its layout or space.`,
        );
        break;
      case "style":
        lines.push(
          `- Image ${n} = STYLE reference "${label}" for mood and color only${note ? ` (${note})` : ""}; no objects or layout.`,
        );
        break;
      case "annotation":
        lines.push(
          `- Image ${n} = ANNOTATION GUIDE with numbered boxes marking the regions below. It is NOT content: never reproduce boxes, numbers, arrows or overlay colors.`,
        );
        break;
    }
  });
  zh.push(
    `底圖＝視角 ${view.id}（${view.name}），參考圖 ${references.length} 張：${
      references.map((r) => input.referenceLabels[r.assetId] ?? r.role).join("、") || "無"
    }`,
  );

  // 2) 保留項
  lines.push("");
  lines.push("PRESERVE (must not change):");
  for (const t of byCat("preserve")) lines.push(`- ${t}`);
  locks.forEach((r, i) => {
    lines.push(`- ${regionLine(r, i + 1, objects)} Keep this region exactly as in image 1.`);
  });
  if (locks.length) zh.push(`鎖定區 ${locks.length} 處`);

  // 3) 本輪修改
  lines.push("");
  lines.push("CHANGES THIS ROUND (only these):");
  if (input.rawRequest.trim()) {
    lines.push(`- Designer request (zh-TW original wording): 「${input.rawRequest.trim()}」`);
  }
  edits.forEach((r, i) => lines.push(`- ${regionLine(r, i + 1, objects)}`));
  if (edits.length && !input.maskSupported) {
    lines.push(
      "- Outside the listed regions the image must stay unchanged; the outside area will be restored from image 1 afterwards, so do not reframe, crop, zoom or shift the image.",
    );
  }
  if (!edits.length && !input.rawRequest.trim()) {
    lines.push("- Rendering quality only: improve realism, light and materials without any design change.");
  }
  zh.push(
    edits.length
      ? `修改區 ${edits.length} 處：${edits.map((r) => r.label || describeArea(shapeBounds(r.shape)).zh).join("、")}`
      : "全圖修改（無選區）",
  );

  // 4) 場景契約
  const linked = new Set(regions.map((r) => r.objectId).filter(Boolean) as string[]);
  const contract = project.sceneObjects.filter((o) => {
    const v = o.views[view.id] ?? "unknown";
    if (linked.has(o.id)) return true;
    if (!input.includeSceneContract) return false;
    return v === "visible" || v === "partial";
  });
  const hidden = input.includeSceneContract
    ? project.sceneObjects.filter((o) => (o.views[view.id] ?? "unknown") === "hidden")
    : [];
  if (contract.length || hidden.length) {
    lines.push("");
    lines.push("SCENE CONTRACT (one house, shared by every view):");
    for (const o of contract) {
      const v = o.views[view.id] ?? "unknown";
      const occl = v === "partial" ? " Partly visible from this camera — show only what is visible." : "";
      lines.push(`- ${o.promptSpec} [anchor: ${o.anchor}]${occl}`);
    }
    if (hidden.length) {
      lines.push(
        `- Not visible from this camera — do NOT add: ${hidden.map((o) => o.promptSpec.split(".")[0]).join("; ")}.`,
      );
    }
    zh.push(`場景物件 ${contract.length} 項套用${hidden.length ? `、${hidden.length} 項標記為本視角不可見` : ""}`);
  }

  // 5) 材質、光線、一致性、風格
  const surface = byCat("surface");
  if (surface.length) {
    lines.push("");
    lines.push("SURFACE POLICY:");
    for (const t of surface) lines.push(`- ${t}`);
  }
  const lighting = byCat("lighting");
  if (lighting.length) {
    lines.push("");
    lines.push("LIGHTING:");
    for (const t of lighting) lines.push(`- ${t}`);
  }
  const cons = byCat("consistency");
  if (cons.length && references.length) {
    lines.push("");
    lines.push("CROSS-VIEW CONSISTENCY:");
    for (const t of cons) lines.push(`- ${t}`);
  }
  const style = byCat("style");
  if (style.length || project.styleBrief.trim()) {
    lines.push("");
    lines.push("STYLE:");
    for (const t of style) lines.push(`- ${t}`);
    if (project.styleBrief.trim()) {
      lines.push(`- Project style brief (zh-TW): 「${project.styleBrief.trim()}」`);
    }
  }

  // 6) 排除與輸出
  lines.push("");
  lines.push(`REJECT: ${REJECT_LIST}.`);
  for (const t of byCat("output")) lines.push(t);

  zh.push(`積木 ${blocks.length} 塊：${blocks.map((b) => b.label).join("、")}`);
  return { prompt: lines.join("\n"), summaryZh: zh };
}

export interface RiskInput {
  view: RenderView;
  hasOriginal: boolean;
  baseStrategy: "original" | "accepted" | "parent";
  generationDepth: number;
  editRegionCount: number;
  references: ReferenceSlot[];
  masters: { viewId: string; accepted: boolean }[];
  repairsUsed: number;
  repairLimit: number;
  maxReferences: number;
}

export interface Risk {
  level: "error" | "warn" | "info";
  text: string;
}

/** 送出前檢查（顯示給設計師，非保證） */
export function preflight(r: RiskInput): Risk[] {
  const out: Risk[] = [];
  if (!r.hasOriginal) out.push({ level: "error", text: "此視角尚未放入 3D 原圖；原圖是幾何與鏡位唯一依據。" });
  if (r.view.role === "derived") {
    const pending = r.masters.filter((m) => !m.accepted);
    if (pending.length)
      out.push({
        level: "error",
        text: `衍生視角需等主圖核准：${pending.map((m) => m.viewId).join("、")} 尚未核准。`,
      });
  }
  if (r.references.length > r.maxReferences)
    out.push({ level: "error", text: `參考圖 ${r.references.length} 張，超過上限 ${r.maxReferences} 張。` });
  if (r.baseStrategy !== "original" && r.editRegionCount === 0)
    out.push({
      level: "warn",
      text: "從前一版做「全圖」修改會讓 AI 重新生成整張圖——這是水波紋累積的主因。建議框選要改的區域，或改用「從原圖單跳」。",
    });
  if (r.generationDepth >= 2)
    out.push({
      level: "warn",
      text: `世代深度 G${r.generationDepth}：已連續 ${r.generationDepth} 次全圖重生成，紋理劣化風險高。`,
    });
  if (r.repairsUsed >= r.repairLimit)
    out.push({
      level: "warn",
      text: `已用 ${r.repairsUsed} 次定向修正，達專案上限 ${r.repairLimit}。建議停下來人工判斷：回原圖重建、人工修圖或調整範圍。`,
    });
  if (r.editRegionCount > 0 && r.baseStrategy !== "original")
    out.push({ level: "info", text: "匯入結果後，系統會把選區外的像素回貼成底圖，避免非修改區劣化。" });
  return out;
}
