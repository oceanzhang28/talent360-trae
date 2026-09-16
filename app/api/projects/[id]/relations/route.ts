import type { NextRequest } from "next/server";
import { ApiError, requireLogin, withApi } from "@/lib/permissions";
import {
  createRelation,
  listRelations,
} from "@/modules/review-relations/service";

type Ctx = { params: Promise<{ id: string }> };

/** 关系列表（项目管理员） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json({ relations: await listRelations(id, user) });
});

/** 手工新增评价关系（PRD 第 20 节；人员不存在则创建） */
export const POST = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body !== "object" || body === null) {
    throw new ApiError(400, "请求体必须是 JSON 对象");
  }
  const relation = await createRelation(id, user, body as never);
  return Response.json({ relation }, { status: 201 });
});
