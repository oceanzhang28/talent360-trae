import type { NextRequest } from "next/server";
import { ApiError, requireLogin, withApi } from "@/lib/permissions";
import {
  deleteTemplate,
  getTemplateDetail,
  renameTemplate,
} from "@/modules/questionnaires/service";

type Ctx = { params: Promise<{ id: string }> };

/** 模板详情（维度树）：供模板库展开预览 */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  await requireLogin();
  const { id } = await params;
  return Response.json({ questionnaire: await getTemplateDetail(id) });
});

/** 模板重命名（仅创建者或系统管理员） */
export const PATCH = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    templateName?: unknown;
  } | null;
  if (!body) throw new ApiError(400, "请求体不能为空");
  return Response.json({
    template: await renameTemplate(id, user, body.templateName),
  });
});

/** 删除模板（仅创建者或系统管理员；不影响已复制的项目问卷） */
export const DELETE = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  await deleteTemplate(id, user);
  return Response.json({ deleted: true });
});
