"use client";

import * as React from "react";
import { Download, FileDown, Globe, Loader2, Play, Plus, Scissors, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { assetBlob, useAssetUrl, useRenderStore } from "@/store/render-store";
import { addAssetFromFile } from "@/lib/render/actions";
import { blobToBase64, canvasToBlob, ctx2d, decodeImage, downloadBlob, makeCanvas, uid } from "@/lib/render/image";
import { presetFaces, ringCoverageIssue, type SeamReport } from "@/lib/render/pano/math";
import { runStitch, sliceToCube } from "@/lib/render/pano/run";
import { buildViewerHtml, PanoViewer } from "@/lib/render/pano/viewer";
import { buildZip, blobEntry } from "@/lib/render/zip";
import type { Panorama, PanoMode, RenderProject } from "@/lib/render/types";
import { FileButton, inputCls, Pill, Segmented, useBusy, useToast } from "./primitives";
import { HFOV_OPTIONS } from "@/lib/render/options";

const MODE_LABEL: Record<PanoMode, string> = {
  ring4: "4 張水平環景",
  cube6: "6 面立方體",
  ringN: "N 張水平環景",
  equirect: "已有全景圖",
};

export function PanoPanel({ project }: { project: RenderProject }) {
  const mutate = useRenderStore((s) => s.mutate);
  const toast = useToast();
  const [sel, setSel] = React.useState<string | null>(project.panoramas[0]?.id ?? null);
  const pano = project.panoramas.find((p) => p.id === sel) ?? null;

  const create = (mode: PanoMode) => {
    const id = uid("pano");
    const faces =
      mode === "equirect" ? [] : presetFaces(mode, mode === "ringN" ? 6 : 4).map((f) => ({ ...f, assetId: null }));
    mutate(project.id, (d) =>
      void d.panoramas.push({
        id,
        name: `${MODE_LABEL[mode]} ${d.panoramas.length + 1}`,
        mode,
        hfov: mode === "ring4" ? 100 : mode === "ringN" ? 75 : 90,
        faces,
        resultAssetId: null,
        createdAt: new Date().toISOString(),
        notes: "",
      }),
    );
    setSel(id);
  };

  return (
    <main className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
      {toast.node}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Globe className="h-4 w-4" /> 360 環景縫合
          </h2>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            把同一個相機位置、依序旋轉拍出的圖縫成等距長方全景（2:1），客戶可拖曳環視；也能匯出單檔 HTML 直接傳給客戶離線開啟。
          </p>
        </div>
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-[11px] leading-relaxed text-warning">
          <p className="flex items-center gap-1 font-semibold">
            <TriangleAlert className="h-3.5 w-3.5" /> 物理前提
          </p>
          從房間不同位置拍的角度（例如一樓 20／29／33／34）<b>不能</b>縫成真實環景——視差會讓接縫處牆線、家具錯位。
          請在 3D 軟體同一點位輸出：最佳是直接輸出 360 全景（Enscape／D5／V-Ray 皆支援），其次 6 面立方體，再其次 4 張水平（建議水平視角 100° 保留重疊）。
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {project.panoramas.map((p) => (
          <button
            key={p.id}
            onClick={() => setSel(p.id)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs",
              sel === p.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-accent",
            )}
          >
            {p.name}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {(["ring4", "cube6", "ringN", "equirect"] as PanoMode[]).map((m) => (
          <Button key={m} size="sm" variant="outline" onClick={() => create(m)}>
            <Plus /> {MODE_LABEL[m]}
          </Button>
        ))}
      </div>

      {pano ? <PanoEditor key={pano.id} project={project} pano={pano} toast={toast} /> : (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">選擇上方模式建立環景。</p>
      )}
    </main>
  );
}

function PanoEditor({ project, pano, toast }: { project: RenderProject; pano: Panorama; toast: ReturnType<typeof useToast> }) {
  const mutate = useRenderStore((s) => s.mutate);
  const { busy, run } = useBusy(toast);
  const [progress, setProgress] = React.useState(0);
  const [outW, setOutW] = React.useState(4096);
  const [harmonize, setHarmonize] = React.useState(true);
  const [fill, setFill] = React.useState(true);
  const [seams, setSeams] = React.useState<SeamReport[] | null>(null);
  const [coverage, setCoverage] = React.useState<{ url: string; ratio: number } | null>(null);
  const [showCov, setShowCov] = React.useState(false);
  const resultUrl = useAssetUrl(pano.resultAssetId);
  const upd = (fn: (p: Panorama) => void) =>
    mutate(project.id, (d) => {
      const p = d.panoramas.find((x) => x.id === pano.id);
      if (p) fn(p);
    });

  const ring = pano.faces.filter((f) => f.pitch === 0).length;
  const coverageIssue = pano.mode === "equirect" ? null : ringCoverageIssue(pano.hfov, ring);
  const ready = pano.faces.length > 0 && pano.faces.every((f) => f.assetId);

  const stitch = () =>
    run("stitch", async () => {
      setProgress(0);
      const faces = [];
      for (const f of pano.faces) {
        const b = await assetBlob(f.assetId!);
        if (!b) throw new Error(`找不到「${f.label}」圖檔`);
        faces.push({ blob: b, yaw: f.yaw, pitch: f.pitch, roll: f.roll, hfov: pano.hfov });
      }
      const { jpeg, coverage: cov, result } = await runStitch(faces, { outW, harmonize, feather: 0.06, fillHoles: fill }, setProgress);
      const meta = await useRenderStore.getState().addAsset(project.id, jpeg, "pano", `${pano.name}.jpg`);
      upd((p) => void (p.resultAssetId = meta.id));
      setSeams(result.seams);
      setCoverage({ url: URL.createObjectURL(cov), ratio: result.coveredRatio });
      toast.ok(`縫合完成：真實來源覆蓋 ${(result.coveredRatio * 100).toFixed(0)}%`);
    });

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <input className={cn(inputCls, "font-semibold")} value={pano.name} onChange={(e) => upd((p) => void (p.name = e.target.value))} />
          <div className="flex flex-wrap gap-1.5">
            <Pill>{MODE_LABEL[pano.mode]}</Pill>
            {pano.mode !== "equirect" && <Pill>水平視角 {pano.hfov}°</Pill>}
          </div>
          {pano.mode !== "equirect" && (
            <label className="flex items-center gap-2 text-xs">
              來源水平視角（度）
              <select
                className="w-24 rounded border border-border bg-card px-2 py-1"
                value={pano.hfov}
                onChange={(e) => upd((p) => void (p.hfov = Number(e.target.value) || 90))}
              >
                {Array.from(new Set([...HFOV_OPTIONS, pano.hfov])).sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {d}°{d === 90 ? "（4 張環景）" : ""}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted-foreground">需與 3D 軟體相機設定一致</span>
            </label>
          )}
          {coverageIssue && <p className="text-[11px] text-danger">{coverageIssue}</p>}
          {pano.mode === "ring4" && pano.hfov === 90 && (
            <p className="text-[11px] text-muted-foreground">剛好 90° 沒有重疊，接縫只能比對色彩；建議 100°。</p>
          )}
        </div>

        {pano.mode === "equirect" ? (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold">上傳 2:1 全景圖</p>
            <FileButton
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm hover:bg-accent"
              onFiles={([f]) =>
                run("up", async () => {
                  const m = await addAssetFromFile(project.id, f, "pano", f.name);
                  if (Math.abs(m.width / m.height - 2) > 0.02) toast.bad(`比例 ${m.width}×${m.height} 不是 2:1，檢視會變形。`);
                  upd((p) => void (p.resultAssetId = m.id));
                })
              }
            >
              選擇全景圖
            </FileButton>
            {pano.resultAssetId && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={!!busy}
                onClick={() =>
                  run("slice", async () => {
                    const b = await assetBlob(pano.resultAssetId!);
                    if (!b) return;
                    const faces = await sliceToCube(b, 1536, presetFaces("cube6"));
                    const zip = buildZip(await Promise.all(faces.map((f, i) => blobEntry(`${i + 1}_${f.label}.png`, f.blob))));
                    downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${pano.name}_立方6面.zip`);
                    toast.ok("已切成 6 面：可逐面 AI 優化後，用「6 面立方體」縫回");
                  })
                }
              >
                <Scissors /> 切成 6 面（逐面 AI 優化用）
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold">來源面（同一點位）</p>
            <div className="grid grid-cols-2 gap-2">
              {pano.faces.map((f, i) => (
                <FaceSlot
                  key={i}
                  label={f.label}
                  assetId={f.assetId}
                  yaw={f.yaw}
                  pitch={f.pitch}
                  roll={f.roll}
                  editableAngles={pano.mode === "ringN"}
                  onFile={(file) =>
                    run("face", async () => {
                      const m = await addAssetFromFile(project.id, file, "pano-face", `${pano.name}_${f.label}`);
                      upd((p) => void (p.faces[i].assetId = m.id));
                    })
                  }
                  onRoll={(r) => upd((p) => void (p.faces[i].roll = r))}
                  onYaw={(y) => upd((p) => void (p.faces[i].yaw = y))}
                />
              ))}
            </div>
            {pano.mode === "ringN" && (
              <div className="flex gap-2 text-[11px]">
                <button
                  className="rounded border border-border px-2 py-0.5 hover:bg-accent"
                  onClick={() =>
                    upd((p) => {
                      const n = Math.min(12, p.faces.length + 1);
                      p.faces = presetFaces("ringN", n).map((f, k) => ({ ...f, assetId: p.faces[k]?.assetId ?? null }));
                    })
                  }
                >
                  ＋ 張數
                </button>
                <button
                  className="rounded border border-border px-2 py-0.5 hover:bg-accent"
                  onClick={() =>
                    upd((p) => {
                      const n = Math.max(3, p.faces.length - 1);
                      p.faces = presetFaces("ringN", n).map((f, k) => ({ ...f, assetId: p.faces[k]?.assetId ?? null }));
                    })
                  }
                >
                  － 張數
                </button>
              </div>
            )}
            <div className="space-y-1.5 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={harmonize} onChange={(e) => setHarmonize(e.target.checked)} />
                自動校色（AI 逐面優化後曝光常不一致）
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
                天花／地板缺口漸層補色（會標示為非真實）
              </label>
              <label className="flex items-center gap-2 text-xs">
                輸出寬度
                <Segmented<string>
                  size="xs"
                  value={String(outW)}
                  onChange={(v) => setOutW(Number(v))}
                  options={[
                    { value: "4096", label: "4K" },
                    { value: "6144", label: "6K" },
                    { value: "8192", label: "8K", title: "部分手機無法顯示 8K 貼圖" },
                  ]}
                />
              </label>
            </div>
            <Button className="w-full" disabled={!ready || !!busy || !!coverageIssue} onClick={stitch}>
              {busy === "stitch" ? <Loader2 className="animate-spin" /> : <Play />}
              {busy === "stitch" ? `縫合中 ${Math.round(progress * 100)}%` : "開始縫合"}
            </Button>
          </div>
        )}

        {seams && seams.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold">接縫檢查</p>
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-normal">接縫</th>
                  <th className="text-left font-normal">色差</th>
                  <th className="text-left font-normal">結構連續</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {seams.map((s) => (
                  <tr key={`${s.a}-${s.b}`}>
                    <td>
                      {pano.faces[s.a]?.label} ↔ {pano.faces[s.b]?.label}
                      {!s.overlap && <span className="text-muted-foreground">（無重疊）</span>}
                    </td>
                    <td className="tabular-nums">{(s.colorDiff * 100).toFixed(1)}%</td>
                    <td className="tabular-nums">{(s.structure * 100).toFixed(0)}%</td>
                    <td>{s.ok ? <Pill tone="ok">OK</Pill> : <Pill tone="warn">檢查</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {seams.some((s) => !s.ok) && (
              <p className="text-[11px] text-warning">
                有接縫不連續：可能來源不是同一點位、視角設定錯，或 AI 逐面優化時改了接縫附近的幾何。請以同一主圖參考重修該面邊緣。
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <ViewerBox url={resultUrl} />
        {resultUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                run("dl", async () => {
                  const b = await assetBlob(pano.resultAssetId!);
                  if (b) downloadBlob(b, `${pano.name}.jpg`);
                })
              }
            >
              <Download /> 全景 JPG
            </Button>
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                run("html", async () => {
                  const b = await assetBlob(pano.resultAssetId!);
                  if (!b) return;
                  const jpg = await toClientJpeg(b);
                  const html = buildViewerHtml(`${project.name}｜${pano.name}`, await blobToBase64(jpg), coverage && coverage.ratio < 0.99 ? "天花／地板部分為補色示意，非實際渲染。" : "");
                  downloadBlob(new Blob([html], { type: "text/html" }), `${pano.name}_360檢視.html`);
                  toast.ok("已匯出單檔 HTML，可直接傳給客戶");
                })
              }
            >
              <FileDown /> 客戶用 360 HTML
            </Button>
            {coverage && (
              <>
                <label className="ml-2 inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={showCov} onChange={(e) => setShowCov(e.target.checked)} /> 顯示覆蓋圖
                </label>
                <span className="text-[11px] text-muted-foreground">真實來源 {(coverage.ratio * 100).toFixed(0)}%</span>
              </>
            )}
          </div>
        )}
        {showCov && coverage && resultUrl && (
          <div className="relative overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="全景" className="w-full" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverage.url} alt="覆蓋" className="absolute inset-0 h-full w-full" />
            <p className="absolute bottom-1 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">橘＝補色（非真實）　紅＝無資料</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** 客戶檔控制在 4096 寬、JPEG 0.88，手機也能順開 */
async function toClientJpeg(b: Blob): Promise<Blob> {
  const bmp = await decodeImage(b);
  const w = Math.min(4096, bmp.width);
  const c = makeCanvas(w, Math.round(w / 2));
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return canvasToBlob(c, "image/jpeg", 0.88);
}

function FaceSlot({
  label,
  assetId,
  yaw,
  pitch,
  roll,
  editableAngles,
  onFile,
  onRoll,
  onYaw,
}: {
  label: string;
  assetId: string | null;
  yaw: number;
  pitch: number;
  roll: number;
  editableAngles: boolean;
  onFile: (f: File) => void;
  onRoll: (r: number) => void;
  onYaw: (y: number) => void;
}) {
  const url = useAssetUrl(assetId);
  const [over, setOver] = React.useState(false);
  return (
    <div
      className={cn("space-y-1 rounded-lg border p-1.5", over ? "border-foreground" : "border-border")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <FileButton className="block w-full" onFiles={([f]) => onFile(f)}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="aspect-video w-full rounded object-cover" />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded bg-muted text-[11px] text-muted-foreground">拖入或點選</div>
        )}
      </FileButton>
      <div className="flex items-center gap-1 text-[10px]">
        <span className="font-medium">{label}</span>
        {editableAngles && (
          <select
            className="ml-auto w-16 rounded border border-border bg-card px-1"
            value={yaw}
            onChange={(e) => onYaw(Number(e.target.value))}
            aria-label="水平角度"
          >
            {Array.from(new Set([...Array.from({ length: 24 }, (_, k) => k * 15), yaw])).sort((a, b) => a - b).map((d) => (
              <option key={d} value={d}>
                {d}°
              </option>
            ))}
          </select>
        )}
        {pitch !== 0 && (
          <select className="ml-auto rounded border border-border bg-card px-1" value={roll} onChange={(e) => onRoll(Number(e.target.value))} aria-label="旋轉校正">
            {[0, 90, 180, 270].map((r) => (
              <option key={r} value={r}>
                旋轉 {r}°
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function ViewerBox({ url }: { url: string | null }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const viewer = React.useRef<PanoViewer | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!ref.current) return;
    try {
      viewer.current = new PanoViewer(ref.current);
    } catch (e) {
      setErr((e as Error).message);
    }
    return () => viewer.current?.destroy();
  }, []);
  React.useEffect(() => {
    const v = viewer.current;
    if (!v || !url) return;
    const img = new Image();
    img.onload = () => {
      const max = v.maxTextureSize;
      if (img.width > max) {
        const c = makeCanvas(max, max / 2);
        ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
        v.setImage(c);
      } else v.setImage(img);
    };
    img.src = url;
  }, [url]);
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-muted">
      <canvas ref={ref} className="h-full w-full" />
      {!url && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">縫合或上傳後在此預覽（拖曳環視、滾輪縮放）</p>
      )}
      {err && <p className="absolute inset-0 flex items-center justify-center text-xs text-danger">{err}</p>}
    </div>
  );
}
