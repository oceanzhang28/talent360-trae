import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import {
  deleteProject,
  getProject,
  updateProject,
} from "@/modules/projects/service";

type Ctx = { params: Promise<{ id: string }> };

/** 项目详情（含管理员、评分档位） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await getProject(id, user));
});

/** 更新项目（按状态限制可编辑字段） */
export const PATCH = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return Response.json({ project: await updateProject(id, user, body) });
});

/** 软删除项目（仅系统管理员；deletedAt + purgeAfter = +30 天） */
export const DELETE = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  await deleteProject(id, user);
  return new Response(null, { status: 204 });
});
