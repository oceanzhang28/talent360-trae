import { requireLogin, withApi } from "@/lib/permissions";
import {
  generateResultsExcel,
  RESULTS_EXCEL_FILENAME,
} from "@/modules/results/excel";

type Ctx = { params: Promise<{ id: string }> };

/** 导出完整结果 Excel（技术文档第 54 节）：仅项目管理员，仅冻结后；service 层写 EXPORT_RESULTS 审计 */
export const POST = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const buffer = await generateResultsExcel(id, user);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${RESULTS_EXCEL_FILENAME}"`,
    },
  });
});
