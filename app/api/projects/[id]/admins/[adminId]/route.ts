import { requireLogin, withApi } from "@/lib/permissions";
import { removeAdmin } from "@/modules/projects/service";

/** 移除项目管理员（不能移除最后一个） */
export const DELETE = withApi<{
  params: Promise<{ id: string; adminId: string }>;
}>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id, adminId } = await params;
  await removeAdmin(id, user, adminId);
  return new Response(null, { status: 204 });
});
