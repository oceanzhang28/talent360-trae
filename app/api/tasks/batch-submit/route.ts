import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { batchSubmitTasks } from "@/modules/review-tasks/service";

/** 批量提交（矩阵模式）：一次提交所有已填写完整的人员，不完整的跳过并返回原因 */
export const POST = withApi(async (req: NextRequest) => {
  const user = await requireLogin();
  const body = await req.json().catch(() => ({}));
  return Response.json(await batchSubmitTasks(user, body));
});
