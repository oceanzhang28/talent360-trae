import { prisma } from "@/lib/db/prisma";
import { ApiError, requireSystemAdmin, withApi } from "@/lib/permissions";

/** 系统管理员：设置/取消 SYSTEM_ADMIN（禁止自我降级，避免锁死） */
export const PATCH = withApi<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const admin = await requireSystemAdmin();
    const { id } = await params;

    const body = (await req.json().catch(() => null)) as {
      systemRole?: unknown;
    } | null;
    if (
      !body ||
      (body.systemRole !== "USER" && body.systemRole !== "SYSTEM_ADMIN")
    ) {
      throw new ApiError(
        400,
        "参数错误：systemRole 必须为 USER 或 SYSTEM_ADMIN",
      );
    }
    if (id === admin.id) {
      throw new ApiError(400, "不能修改自己的系统管理员角色");
    }

    const user = await prisma.user.update({
      where: { id },
      data: { systemRole: body.systemRole },
    });
    return Response.json({
      id: user.id,
      employeeNo: user.employeeNo,
      name: user.name,
      systemRole: user.systemRole,
    });
  },
);
