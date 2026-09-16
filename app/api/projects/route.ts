import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { createProject, listProjects } from "@/modules/projects/service";

/** 项目列表：系统管理员看所有，HR 只看自己管理的项目 */
export const GET = withApi(async () => {
  const user = await requireLogin();
  return Response.json({ projects: await listProjects(user) });
});

/** 创建项目：任何登录用户可创建，创建者自动成为项目管理员 */
export const POST = withApi(async (req: NextRequest) => {
  const user = await requireLogin();
  const body = await req.json().catch(() => ({}));
  const project = await createProject(user, body);
  return Response.json({ project }, { status: 201 });
});
