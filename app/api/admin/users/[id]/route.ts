import { prisma } from "@/lib/db/prisma";
import { ApiError, requireSystemAdmin, withApi } from "@/lib/permissions";

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** 系统管理员：编辑人员信息（姓名/部门/岗位/职级）与设置/取消 SYSTEM_ADMIN（禁止自我降级） */
export const PATCH = withApi<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const admin = await requireSystemAdmin();
    const { id } = await params;

    const body = (await req.json().catch(() => null)) as {
      systemRole?: unknown;
      name?: unknown;
      department?: unknown;
      position?: unknown;
      grade?: unknown;
    } | null;
    if (!body) throw new ApiError(400, "请求体不能为空");

    const data: {
      systemRole?: "USER" | "SYSTEM_ADMIN";
      name?: string;
      department?: string | null;
      position?: string | null;
      grade?: string | null;
    } = {};

    if (body.systemRole !== undefined) {
      if (body.systemRole !== "USER" && body.systemRole !== "SYSTEM_ADMIN") {
        throw new ApiError(
          400,
          "参数错误：systemRole 必须为 USER 或 SYSTEM_ADMIN",
        );
      }
      if (id === admin.id) {
        throw new ApiError(400, "不能修改自己的系统管理员角色");
      }
      data.systemRole = body.systemRole;
    }
    if (body.name !== undefined) {
      const name = trim(body.name);
      if (!name) throw new ApiError(400, "姓名不能为空");
      data.name = name;
    }
    if (body.department !== undefined) {
      data.department = trim(body.department) || null;
    }
    if (body.position !== undefined) {
      data.position = trim(body.position) || null;
    }
    if (body.grade !== undefined) {
      data.grade = trim(body.grade) || null;
    }
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, "没有可更新的字段");
    }

    const user = await prisma.user.update({ where: { id }, data });
    return Response.json({
      id: user.id,
      employeeNo: user.employeeNo,
      name: user.name,
      systemRole: user.systemRole,
      department: user.department,
      position: user.position,
      grade: user.grade,
    });
  },
);
