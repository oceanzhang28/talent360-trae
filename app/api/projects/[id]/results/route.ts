import { requireLogin, withApi } from "@/lib/permissions";
import { listProjectResults } from "@/modules/results/service";

type Ctx = { params: Promise<{ id: string }> };

/** HR 结果后台（PRD 第 38 节）：被评人列表，只读 ResultSnapshot（未冻结返回 frozen=false） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await listProjectResults(id, user));
});
