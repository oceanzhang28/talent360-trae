import { prisma } from "@/lib/db/prisma";
import { requireSystemAdmin, withApi } from "@/lib/permissions";

/** 系统管理员：用户列表 */
export const GET = withApi(async () => {
  await requireSystemAdmin();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return Response.json(
    users.map((u) => ({
      id: u.id,
      employeeNo: u.employeeNo,
      name: u.name,
      systemRole: u.systemRole,
      feishuBound: Boolean(u.feishuOpenId),
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
  );
});
