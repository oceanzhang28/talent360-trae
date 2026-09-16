import type { NextRequest } from "next/server";
import { ApiError, requireLogin, withApi } from "@/lib/permissions";
import { addAdmin } from "@/modules/projects/service";

/** 添加项目管理员（按工号，用户需已存在） */
export const POST = withApi<{ params: Promise<{ id: string }> }>(
  async (req: NextRequest, { params }) => {
    const user = await requireLogin();
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      employeeNo?: unknown;
    } | null;
    if (!body || typeof body.employeeNo !== "string") {
      throw new ApiError(400, "参数错误：employeeNo 必须为字符串");
    }
    return Response.json({ admin: await addAdmin(id, user, body.employeeNo) });
  },
);
