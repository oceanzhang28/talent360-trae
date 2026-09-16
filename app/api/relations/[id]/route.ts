import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import {
  deleteRelation,
  updateRelation,
} from "@/modules/review-relations/service";

type Ctx = { params: Promise<{ id: string }> };

/** 修改关系类型（PRD 第 20 节：已有提交仍可调整；写 CHANGE_RELATION 审计） */
export const PATCH = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const relation = await updateRelation(id, user, body?.relationType);
  return Response.json({ relation });
});

/** 删除关系：已提交 → active=false（不参与结果）；否则物理删除；写 DELETE_RELATION 审计 */
export const DELETE = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json(await deleteRelation(id, user));
});
