"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { shapeBounds } from "@/lib/render/compiler";
import type { BrushShape, Region, RegionKind, RippleReport } from "@/lib/render/types";
import { uid } from "@/lib/render/image";

export type Tool = "select" | "edit" | "lock" | "object" | "brush";
export type StageMode = "base" | "result" | "compare" | "original";

const KIND_COLOR: Record<RegionKind, string> = {
  edit: "#e11d48",
  lock: "#2563eb",
  object: "#d97706",
};

export interface StageProps {
  urls: { base: string | null; result: string | null; original: string | null };
  naturalWidth: number;
  aspect: number;
  mode: StageMode;
  zoom: "fit" | "full";
  regions: Region[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  editable: boolean;
  tool: Tool;
  brushRadius: number;
  onCreate: (r: Region) => void;
  onBrush: (regionId: string, shape: BrushShape) => void;
  heat: RippleReport["grid"] | null;
  findings: RippleReport["findings"];
}

export function AnnotationStage(p: StageProps) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [draft, setDraft] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [stroke, setStroke] = React.useState<{ x: number; y: number }[] | null>(null);
  const [split, setSplit] = React.useState(0.5);
  const splitDrag = React.useRef(false);
  const VB_W = 1000;
  const VB_H = 1000 / p.aspect;

  const norm = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const drawing = p.editable && p.tool !== "select";

  const onDown = (e: React.PointerEvent) => {
    if (p.mode === "compare" && !drawing) {
      splitDrag.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setSplit(norm(e).x);
      return;
    }
    if (!drawing) {
      p.onSelect(null);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const n = norm(e);
    if (p.tool === "brush") setStroke([n]);
    else setDraft({ x0: n.x, y0: n.y, x1: n.x, y1: n.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (splitDrag.current) {
      setSplit(norm(e).x);
      return;
    }
    if (draft) {
      const n = norm(e);
      setDraft({ ...draft, x1: n.x, y1: n.y });
    } else if (stroke) {
      const n = norm(e);
      const last = stroke[stroke.length - 1];
      if (Math.hypot(n.x - last.x, (n.y - last.y) / p.aspect) > p.brushRadius * 0.35) setStroke([...stroke, n]);
    }
  };
  const onUp = () => {
    splitDrag.current = false;
    if (draft) {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      setDraft(null);
      if (w > 0.01 && h > 0.01) {
        const kind = p.tool as RegionKind;
        p.onCreate({
          id: uid("rg"),
          kind,
          shape: { type: "rect", x, y, w, h },
          label: "",
          instruction: "",
          objectId: null,
          blockIds: [],
        });
      }
    }
    if (stroke) {
      const sel = p.regions.find((r) => r.id === p.selectedId);
      if (sel && sel.shape.type === "brush") {
        p.onBrush(sel.id, { ...sel.shape, strokes: [...sel.shape.strokes, stroke] });
      } else {
        p.onCreate({
          id: uid("rg"),
          kind: "edit",
          shape: { type: "brush", strokes: [stroke], radius: p.brushRadius },
          label: "",
          instruction: "",
          objectId: null,
          blockIds: [],
        });
      }
      setStroke(null);
    }
  };

  const mainUrl =
    p.mode === "original" ? p.urls.original : p.mode === "result" ? p.urls.result ?? p.urls.base : p.urls.base;

  const counters: Record<RegionKind, number> = { edit: 0, lock: 0, object: 0 };
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [fitW, setFitW] = React.useState(0);
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cw = el.clientWidth - 24;
      const ch = el.clientHeight - 24;
      setFitW(Math.max(80, Math.min(cw, ch * p.aspect)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.aspect]);
  const width = p.zoom === "fit" ? fitW : p.naturalWidth;

  return (
    <div
      ref={boxRef}
      className={cn("relative h-full w-full", p.zoom === "fit" ? "flex items-center justify-center overflow-hidden" : "overflow-auto p-3")}
    >
      <div className="relative shrink-0 select-none" style={{ width, height: width / p.aspect }}>
        {mainUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mainUrl} alt="" className="absolute inset-0 h-full w-full" draggable={false} />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}
        {p.mode === "compare" && p.urls.result && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.urls.result}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full"
            style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}
          />
        )}
        {p.heat && (p.mode === "result" || p.mode === "compare") && <Heat grid={p.heat} />}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className={cn("absolute inset-0 h-full w-full", drawing ? "cursor-crosshair" : p.mode === "compare" ? "cursor-ew-resize" : "cursor-default")}
          style={{ touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {p.mode === "compare" && p.urls.result && (
            <g pointerEvents="none">
              <line x1={split * VB_W} x2={split * VB_W} y1={0} y2={VB_H} stroke="#fff" strokeWidth={2} />
              <rect x={split * VB_W - 14} y={VB_H / 2 - 14} width={28} height={28} rx={14} fill="#fff" stroke="#1c1917" strokeWidth={1.5} />
              <text x={8} y={22} fontSize={16} fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke">底圖</text>
              <text x={VB_W - 8} y={22} fontSize={16} textAnchor="end" fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke">AI 結果</text>
            </g>
          )}
          {p.findings.map((f, i) => (
            <rect
              key={`f${i}`}
              x={f.x * VB_W}
              y={f.y * VB_H}
              width={f.w * VB_W}
              height={f.h * VB_H}
              fill="none"
              stroke="#facc15"
              strokeWidth={2.5}
              strokeDasharray="5 4"
              pointerEvents="none"
            />
          ))}
          {p.regions.map((r) => {
            counters[r.kind]++;
            const tag = `${r.kind === "edit" ? "E" : r.kind === "lock" ? "L" : "O"}${counters[r.kind]}`;
            const color = KIND_COLOR[r.kind];
            const sel = r.id === p.selectedId;
            const b = shapeBounds(r.shape, p.aspect);
            return (
              <g
                key={r.id}
                onPointerDown={(e) => {
                  if (drawing && !(p.tool === "brush" && r.shape.type === "brush")) return;
                  e.stopPropagation();
                  p.onSelect(r.id);
                }}
                className="cursor-pointer"
              >
                {r.shape.type === "rect" ? (
                  <rect
                    x={r.shape.x * VB_W}
                    y={r.shape.y * VB_H}
                    width={r.shape.w * VB_W}
                    height={r.shape.h * VB_H}
                    fill={color}
                    fillOpacity={p.editable ? (sel ? 0.22 : 0.1) : 0}
                    stroke={color}
                    strokeWidth={sel ? 3 : 2}
                    strokeDasharray={r.kind === "lock" ? "8 5" : undefined}
                  />
                ) : (
                  r.shape.strokes.map((s, i) => (
                    <polyline
                      key={i}
                      points={s.map((q) => `${q.x * VB_W},${q.y * VB_H}`).join(" ")}
                      fill="none"
                      stroke={color}
                      strokeOpacity={p.editable ? (sel ? 0.45 : 0.3) : 0.12}
                      strokeWidth={(r.shape as BrushShape).radius * 2 * VB_W}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))
                )}
                <rect x={b.x * VB_W} y={b.y * VB_H} width={34} height={20} fill={color} />
                <text x={b.x * VB_W + 5} y={b.y * VB_H + 15} fontSize={14} fontWeight={700} fill="#fff">
                  {tag}
                </text>
              </g>
            );
          })}
          {draft && (
            <rect
              x={Math.min(draft.x0, draft.x1) * VB_W}
              y={Math.min(draft.y0, draft.y1) * VB_H}
              width={Math.abs(draft.x1 - draft.x0) * VB_W}
              height={Math.abs(draft.y1 - draft.y0) * VB_H}
              fill={KIND_COLOR[(p.tool === "brush" ? "edit" : p.tool) as RegionKind] ?? "#e11d48"}
              fillOpacity={0.15}
              stroke="#fff"
              strokeDasharray="6 4"
              strokeWidth={2}
            />
          )}
          {stroke && (
            <polyline
              points={stroke.map((q) => `${q.x * VB_W},${q.y * VB_H}`).join(" ")}
              fill="none"
              stroke={KIND_COLOR.edit}
              strokeOpacity={0.4}
              strokeWidth={p.brushRadius * 2 * VB_W}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

function Heat({ grid }: { grid: RippleReport["grid"] }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = grid.cols;
    c.height = grid.rows;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(grid.cols, grid.rows);
    grid.scores.forEach((s, i) => {
      if (s < 0.2) return;
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = Math.round(200 * (1 - s));
      img.data[i * 4 + 2] = 40;
      img.data[i * 4 + 3] = Math.round(60 + 150 * s);
    });
    ctx.putImageData(img, 0, 0);
  }, [grid]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full mix-blend-multiply" />;
}
