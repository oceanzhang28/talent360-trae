import { requireLogin, withApi } from "@/lib/permissions";
import { returnTask } from "@/modules/review-tasks/service";

type Ctx = { params: Promise<{ id: string }> };

/** HR 退回已提交评价：任务 RETURNED + 当前 Submission 失效 + RETURN_REVIEW 审计 */
export const POST = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await returnTask(id, user));
});
