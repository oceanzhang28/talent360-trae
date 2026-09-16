import { requireLogin, withApi } from "@/lib/permissions";
import { listPeople } from "@/modules/review-relations/service";

type Ctx = { params: Promise<{ id: string }> };

/** 项目人员列表（快照，含被评/评价次数统计） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json({ people: await listPeople(id, user) });
});
