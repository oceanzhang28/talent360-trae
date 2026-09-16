import { requireLogin, withApi } from "@/lib/permissions";
import { restoreProject } from "@/modules/projects/service";

type Ctx = { params: Promise<{ id: string }> };

/** 从回收站恢复项目（仅系统管理员）：还原删除前状态并写 RESTORE_PROJECT 审计 */
export const POST = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json({ project: await restoreProject(id, user) });
});
