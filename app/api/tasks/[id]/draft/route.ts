import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { getDraft, saveDraft } from "@/modules/review-tasks/service";

type Ctx = { params: Promise<{ id: string }> };

/** 读取草稿（铁律 4：仅评价人本人；任何 HR 接口不暴露 DraftAnswer） */
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  return Response.json({ answers: await getDraft(id, user) });
});

/**
 * 增量保存草稿：body = { answers: [{ questionId, score?, textValue? }] }。
 * 前端 debounce 后只提交变化字段；首次写入任务进入 IN_PROGRESS。
 */
export const PUT = withApi<Ctx>(async (req: NextRequest, { params }) => {
  const user = await requireLogin();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return Response.json(await saveDraft(id, user, body));
});
