"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { useRenderStore } from "@/store/render-store";

/** 載入本機專案資料庫；未就緒前顯示載入狀態 */
export function RenderBoot({ children }: { children: React.ReactNode }) {
  const ready = useRenderStore((s) => s.ready);
  const error = useRenderStore((s) => s.error);
  const loadAll = useRenderStore((s) => s.loadAll);
  React.useEffect(() => {
    if (!ready) loadAll();
  }, [ready, loadAll]);
  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 載入本機專案…
      </div>
    );
  }
  if (error) {
    return <div className="m-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>;
  }
  return <>{children}</>;
}
