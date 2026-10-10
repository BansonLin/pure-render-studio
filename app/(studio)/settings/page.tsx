import { StudioHeader } from "@/components/layout/StudioHeader";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const metadata = { title: "設定" };

export default function SettingsPage() {
  return (
    <>
      <StudioHeader description="API 金鑰、模型、空間與圖號預設（存在後台）" />
      <SettingsPanel />
    </>
  );
}
