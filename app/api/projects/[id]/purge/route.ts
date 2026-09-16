import { requireLogin, withApi } from "@/lib/permissions";
import { purgeProject } from "@/modules/projects/service";

type Ctx = { params: Promise<{ id: string }> };

/** 彻底清理回收站项目（仅系统管理员，需已过 30 天保留期；级联删除全部数据） */
export const DELETE = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  await purgeProject(id, user);
  return new Response(null, { status: 204 });
});
