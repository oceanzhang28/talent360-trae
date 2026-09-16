import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { readExcelUpload } from "@/lib/excel-upload";
import { commitRelationsImport } from "@/modules/review-relations/service";

type Ctx = { params: Promise<{ id: string }> };

/** 正式导入：数据库事务整体替换，失败整批回滚；新被评人自动生成自评 */
export const POST = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const buffer = await readExcelUpload(req);
  const result = await commitRelationsImport(id, user, buffer);
  return Response.json({ result });
});
