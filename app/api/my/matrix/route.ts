import type { NextRequest } from "next/server";
import { requireLogin, withApi } from "@/lib/permissions";
import { getMyMatrix } from "@/modules/review-tasks/service";

/** 矩阵模式数据：按关系返回全部任务 + 问卷结构 + 草稿（与单人模式共用 DraftAnswer） */
export const GET = withApi(async (req: NextRequest) => {
  const user = await requireLogin();
  const relation = req.nextUrl.searchParams.get("relation") ?? undefined;
  return Response.json(await getMyMatrix(user, relation));
});
