import { withApi } from "@/lib/permissions";
import { generateRelationTemplate } from "@/modules/review-relations/excel";

type Ctx = { params: Promise<{ id: string }> };

/** 下载关系导入 Excel 模板（PRD 16.1 的 8 个字段 + 示例 + 填写说明） */
export const GET = withApi<Ctx>(async () => {
  const buffer = await generateRelationTemplate();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="relations-template.xlsx"',
    },
  });
});
