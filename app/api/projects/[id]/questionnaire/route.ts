import { requireLogin, withApi } from "@/lib/permissions";
import { getProjectQuestionnaire } from "@/modules/questionnaires/service";

type Ctx = { params: Promise<{ id: string }> };

/** 项目问卷树（未导入时 questionnaire = null） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json({
    questionnaire: await getProjectQuestionnaire(id, user),
  });
});
