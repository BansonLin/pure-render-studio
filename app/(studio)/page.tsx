import { StudioHeader } from "@/components/layout/StudioHeader";
import { ProjectList } from "@/components/render/ProjectList";

export const metadata = { title: "專案" };

export default function HomePage() {
  return (
    <>
      <StudioHeader description="3D 圖 AI 優化：專案畫布 / 區域指令 / 跨視角一致 / 水波紋篩查 / 360 環景" />
      <ProjectList />
    </>
  );
}
