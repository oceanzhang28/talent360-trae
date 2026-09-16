import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { readExcelUpload } from "@/lib/excel-upload";
import { previewRelationsImport } from "@/modules/review-relations/service";

type Ctx = { params: Promise<{ id: string }> };

/** 导入预检查：解析 → 校验，返回 total/valid/errors/duplicates/conflicts，不写正式表 */
export const POST = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const buffer = await readExcelUpload(req);
  return Response.json(await previewRelationsImport(id, user, buffer));
});
