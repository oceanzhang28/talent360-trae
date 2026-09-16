import { requireLogin, withApi } from "@/lib/permissions";
import { purgeExpiredProjects } from "@/modules/projects/service";

/** 一键清理已过 30 天保留期的回收站项目（仅系统管理员，PRD 第 44 节） */
export const POST = withApi(async () => {
  const user = await requireLogin();
  return Response.json(await purgeExpiredProjects(user));
});
