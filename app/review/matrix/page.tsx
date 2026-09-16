import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/service";
import { getMyMatrix } from "@/modules/review-tasks/service";
import { MatrixView } from "./matrix-view";

export const metadata = {
  title: "矩阵评价 | Talent 360",
};

/** 矩阵评价页（PRD 第 24.2 节）：?relation=XXX&dimension=xxx；服务端加载数据，客户端负责分页与自动保存 */
export default async function MatrixReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ relation?: string; dimension?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const { relation, dimension } = await searchParams;
  const data = await getMyMatrix(user, relation);
  return <MatrixView data={data} initialDimension={dimension ?? null} />;
}
