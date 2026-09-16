import type { NextRequest } from "next/server";
import { requireLogin, requireProjectAdmin, withApi } from "@/lib/permissions";
import { checkQuestionnaireExcel } from "@/modules/questionnaires/service";
import { readExcelUpload } from "@/lib/excel-upload";

type Ctx = { params: Promise<{ id: string }> };

/** 只校验不写入：返回解析错误与结构/权重校验错误的完整报告 */
export const POST = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  await requireProjectAdmin(id, user);
  const buffer = await readExcelUpload(req);
  return Response.json(await checkQuestionnaireExcel(buffer));
});
