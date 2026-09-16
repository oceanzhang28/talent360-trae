import { withApi } from "@/lib/permissions";
import { generateQuestionnaireTemplate } from "@/modules/questionnaires/excel";

type Ctx = { params: Promise<{ id: string }> };

/** 下载问卷导入 Excel 模板（16 个标准字段 + 示例 + 填写说明，PRD 12.2） */
export const GET = withApi<Ctx>(async () => {
  const buffer = await generateQuestionnaireTemplate();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="questionnaire-template.xlsx"',
    },
  });
});
