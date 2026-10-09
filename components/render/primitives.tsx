"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssetUrl } from "@/store/render-store";
import { STATE_LABEL, STATE_TONE } from "@/lib/render/workflow";
import type { VersionState } from "@/lib/render/types";

const TONE: Record<string, string> = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  warn: "bg-warning/15 text-warning",
  ok: "bg-success/15 text-success",
  bad: "bg-danger/15 text-danger",
};

export function Pill({
  tone = "muted",
  className,
  children,
  title,
}: {
  tone?: keyof typeof TONE;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StateBadge({ state }: { state: VersionState }) {
  return <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>;
}

export function AssetImg({
  id,
  alt,
  className,
  style,
  draggable = false,
}: {
  id: string | null | undefined;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
}) {
  const url = useAssetUrl(id);
  if (!url) return <div className={cn("bg-muted", className)} style={style} aria-label={alt} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} style={style} draggable={draggable} />;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-foreground/40 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true">
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden bg-background shadow-2xl sm:rounded-xl",
          wide ? "max-w-[1680px]" : "max-w-xl self-center",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
          <button aria-label="關閉" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function FileButton({
  accept = "image/png,image/jpeg,image/webp",
  multiple = false,
  onFiles,
  children,
  className,
  disabled,
}: {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "xs";
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputCls =
  "w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/30";

export function useToast() {
  const [msg, setMsg] = React.useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  React.useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4200);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div
      role="status"
      className={cn(
        "fixed bottom-4 left-1/2 z-[60] max-w-[92vw] -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg",
        msg.tone === "ok" ? "bg-foreground text-background" : "bg-danger text-danger-foreground",
      )}
    >
      {msg.text}
    </div>
  ) : null;
  return {
    node,
    ok: (text: string) => setMsg({ text, tone: "ok" }),
    bad: (text: string) => setMsg({ text, tone: "bad" }),
  };
}

/** 包裝非同步動作：自動顯示錯誤、避免重複點擊 */
export function useBusy(toast: ReturnType<typeof useToast>) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = React.useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(label);
      try {
        return await fn();
      } catch (e) {
        toast.bad((e as Error).message || "發生錯誤");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}
