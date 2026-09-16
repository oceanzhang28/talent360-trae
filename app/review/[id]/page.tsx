import { notFound, redirect } from "next/navigation";
import { ApiError } from "@/lib/permissions";
import { getCurrentUser } from "@/modules/auth/service";
import { getDraft, getTaskDetail } from "@/modules/review-tasks/service";
import { ReviewForm } from "./review-form";

export const metadata = {
  title: "填写评价 | Talent 360",
};

/** 评价填写页（单人模式）：服务端加载任务结构 + 草稿，客户端组件负责填写与自动保存 */
export default async function TaskReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getTaskDetail>> | null = null;
  let draft: Awaited<ReturnType<typeof getDraft>> = [];
  try {
    [detail, draft] = await Promise.all([
      getTaskDetail(id, user),
      getDraft(id, user),
    ]);
  } catch (err) {
    if (!(
      err instanceof ApiError &&
      (err.status === 404 || err.status === 403)
    )) {
      throw err;
    }
  }
  if (!detail) {
    notFound();
  }
  return <ReviewForm detail={detail} initialAnswers={draft} />;
}
