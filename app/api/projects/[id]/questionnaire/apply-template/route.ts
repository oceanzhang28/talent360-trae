import type { NextRequest } from "next/server";
import { ApiError, requireLogin, withApi } from "@/lib/permissions";
import { applyTemplate } from "@/modules/questionnaires/service";

type Ctx = { params: Promise<{ id: string }> };

/** 从模板复制问卷到项目（整体替换，受修改窗口限制） */
export const POST = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.templateId !== "string" || !body.templateId) {
    throw new ApiError(400, "缺少模板 ID");
  }
  const questionnaire = await applyTemplate(id, user, body.templateId);
  return Response.json({ questionnaire });
});
