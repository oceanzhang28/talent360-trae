import { requireLogin, withApi } from "@/lib/permissions";
import { getTaskDetail } from "@/modules/review-tasks/service";

type Ctx = { params: Promise<{ id: string }> };

/** 任务详情：被评人信息 + 按该关系过滤的问卷结构 + 项目量表（仅评价人本人） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await getTaskDetail(id, user));
});
