import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { saveAsTemplate } from "@/modules/questionnaires/service";

type Ctx = { params: Promise<{ id: string }> };

/** 把当前项目问卷保存为模板（深拷贝维度 + 题目） */
export const POST = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const template = await saveAsTemplate(id, user, body?.templateName);
  return Response.json({ template }, { status: 201 });
});
