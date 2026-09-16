import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireLogin, withApi } from "@/lib/permissions";
import {
  deleteProject,
  getProject,
  updateProject,
} from "@/modules/projects/service";
import { syncSelfRelations } from "@/modules/review-relations/service";

type Ctx = { params: Promise<{ id: string }> };

/** 项目详情（含管理员、评分档位） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await getProject(id, user));
});

/** 更新项目（按状态限制可编辑字段）；自评开关变化时同步自评关系 */
export const PATCH = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const project = await updateProject(id, user, body);
  if (typeof body?.selfReviewEnabled === "boolean") {
    await prisma.$transaction(async (tx) => {
      await syncSelfRelations(tx, id);
    });
  }
  return Response.json({ project });
});

/** 软删除项目（仅系统管理员；deletedAt + purgeAfter = +30 天） */
export const DELETE = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  await deleteProject(id, user);
  return new Response(null, { status: 204 });
});
