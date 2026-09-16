import { requireLogin, withApi } from "@/lib/permissions";
import {
  getProjectQuestionnaire,
  saveProjectQuestionnaire,
} from "@/modules/questionnaires/service";

type Ctx = { params: Promise<{ id: string }> };

/** 项目问卷树（未导入时 questionnaire = null） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json({
    questionnaire: await getProjectQuestionnaire(id, user),
  });
});

/**
 * 在线搭建 / 编辑保存（PRD 第 12.1 节）：整树替换。
 * 允许保存中间状态，返回当前校验结果供 UI 实时提示；完整性由发布前校验兜底。
 */
export const PUT = withApi<Ctx>(async (req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  return Response.json(await saveProjectQuestionnaire(id, user, body));
});
