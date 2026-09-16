import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { readExcelUpload } from "@/modules/questionnaires/upload";
import { importQuestionnaire } from "@/modules/questionnaires/service";

type Ctx = { params: Promise<{ id: string }> };

/** Excel 导入：解析 → 校验 → 事务整体替换项目问卷（错误返回明细） */
export const POST = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const buffer = await readExcelUpload(req);
  const questionnaire = await importQuestionnaire(id, user, buffer);
  return Response.json({ questionnaire });
});
