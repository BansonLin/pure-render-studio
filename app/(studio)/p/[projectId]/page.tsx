import { StudioHeader } from "@/components/layout/StudioHeader";
import { Workspace } from "@/components/render/Workspace";

export const metadata = { title: "工作區" };

export default function ProjectPage({ params }: { params: { projectId: string } }) {
  return (
    <>
      <StudioHeader description="主圖先核准 → 衍生視角讀取同一份物件聖經；修正一律框選區域、開新版本" />
      <Workspace projectId={params.projectId} />
    </>
  );
}
