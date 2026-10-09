import { StudioHeader } from "@/components/layout/StudioHeader";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const metadata = { title: "設定" };

export default function SettingsPage() {
  return (
    <>
      <StudioHeader description="API 金鑰與模型（只存在這台裝置）" />
      <SettingsPanel />
    </>
  );
}
