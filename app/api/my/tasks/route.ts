import { requireLogin, withApi } from "@/lib/permissions";
import { listMyTasks } from "@/modules/review-tasks/service";

/** 我的评价任务：按关系分组 + 状态计数（技术文档第 42 节） */
export const GET = withApi(async () => {
  const user = await requireLogin();
  return Response.json(await listMyTasks(user));
});
