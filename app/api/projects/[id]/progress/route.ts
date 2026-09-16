import { requireLogin, withApi } from "@/lib/permissions";
import { getProjectProgress } from "@/modules/results/service";

type Ctx = { params: Promise<{ id: string }> };

/** 项目进度看板（PRD 第 30 节）：总体 + 按评价人 + 按被评人分关系完成表 */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await getProjectProgress(id, user));
});
