import { requireLogin, withApi } from "@/lib/permissions";
import { listDeletedProjects } from "@/modules/projects/service";

/** 回收站项目列表（仅系统管理员，PRD 第 44 节） */
export const GET = withApi(async () => {
  const user = await requireLogin();
  return Response.json({ projects: await listDeletedProjects(user) });
});
