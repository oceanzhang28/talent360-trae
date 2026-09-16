import { requireLogin, withApi } from "@/lib/permissions";
import { submitTask } from "@/modules/review-tasks/service";

type Ctx = { params: Promise<{ id: string }> };

/** 按人提交：生成 Submission 版本快照；必答项不全拒绝；首次提交锁定问卷 */
export const POST = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await submitTask(id, user));
});
