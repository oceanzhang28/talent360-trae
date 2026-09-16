import { requireLogin, withApi } from "@/lib/permissions";
import { listTemplates } from "@/modules/questionnaires/service";

/** 问卷模板列表（模板库对所有登录用户可见，PRD 第 13 节） */
export const GET = withApi(async () => {
  await requireLogin();
  return Response.json({ templates: await listTemplates() });
});
