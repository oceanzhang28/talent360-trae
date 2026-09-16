import { prisma } from "@/lib/db/prisma";
import { ApiError, requireSystemAdmin, withApi } from "@/lib/permissions";

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

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
      department: u.department,
      position: u.position,
      grade: u.grade,
      feishuBound: Boolean(u.feishuOpenId),
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
  );
});

/** 系统管理员：新增人员（人员初始化配置） */
export const POST = withApi(async (req) => {
  await requireSystemAdmin();
  const body = (await req.json().catch(() => null)) as {
    employeeNo?: unknown;
    name?: unknown;
    department?: unknown;
    position?: unknown;
    grade?: unknown;
    systemRole?: unknown;
  } | null;
  if (!body) throw new ApiError(400, "请求体不能为空");
  const employeeNo = trim(body.employeeNo);
  const name = trim(body.name);
  if (!employeeNo || !name) {
    throw new ApiError(400, "工号和姓名不能为空");
  }
  const systemRole: "USER" | "SYSTEM_ADMIN" =
    body.systemRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "USER";

  const existing = await prisma.user.findUnique({ where: { employeeNo } });
  if (existing) {
    throw new ApiError(409, `工号 ${employeeNo} 已存在`);
  }

  const user = await prisma.user.create({
    data: {
      employeeNo,
      name,
      systemRole,
      department: trim(body.department) || null,
      position: trim(body.position) || null,
      grade: trim(body.grade) || null,
    },
  });
  return Response.json(
    {
      user: {
        id: user.id,
        employeeNo: user.employeeNo,
        name: user.name,
        systemRole: user.systemRole,
        department: user.department,
        position: user.position,
        grade: user.grade,
      },
    },
    { status: 201 },
  );
});
