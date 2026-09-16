import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions/errors";
import type { FeishuIdentity } from "@/modules/feishu/auth";
import {
  clearSessionCookie,
  readSessionUserId,
  setSessionCookie,
} from "./session";

/** /api/me 对外字段（不暴露 openId / unionId） */
export function serializeUser(user: User) {
  return {
    id: user.id,
    employeeNo: user.employeeNo,
    name: user.name,
    systemRole: user.systemRole,
    lastLoginAt: user.lastLoginAt,
  };
}

/** 当前登录用户：每次从 DB 加载，保证 systemRole 等实时生效 */
export async function getCurrentUser(): Promise<User | null> {
  const userId = await readSessionUserId();
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

/**
 * mock 登录（AUTH_MODE=mock 开发模式专用）：
 * 输入 employeeNo + 姓名，模拟飞书身份完成登录，自动 upsert User。
 */
export async function loginWithMock(input: {
  employeeNo: string;
  name: string;
}): Promise<User> {
  if (process.env.AUTH_MODE !== "mock") {
    throw new ApiError(404, "当前环境未启用 mock 登录");
  }
  const employeeNo = input.employeeNo.trim();
  const name = input.name.trim();
  if (!employeeNo || employeeNo.length > 64) {
    throw new ApiError(400, "工号不能为空且不超过 64 字符");
  }
  if (!name || name.length > 64) {
    throw new ApiError(400, "姓名不能为空且不超过 64 字符");
  }
  const user = await prisma.user.upsert({
    where: { employeeNo },
    update: { name, lastLoginAt: new Date() },
    create: { employeeNo, name, lastLoginAt: new Date() },
  });
  await setSessionCookie(user.id);
  return user;
}

/**
 * 飞书身份登录（服务端身份校验链，技术文档第 38 节）：
 * OAuth 成功 → 必须能取到 employeeNo → openId/employeeNo 匹配或绑定 → 建立会话。
 * 只解析用户并落库，不写 Cookie（由 callback 路由在 redirect 响应上设置）。
 */
export async function resolveFeishuUser(
  identity: FeishuIdentity,
): Promise<User> {
  if (!identity.employeeNo) {
    throw new ApiError(403, "飞书账号未关联员工工号，无法登录（身份匹配失败）");
  }

  // 1. 按 openId 查找已有绑定
  const byOpenId = await prisma.user.findUnique({
    where: { feishuOpenId: identity.openId },
  });
  if (byOpenId) {
    if (byOpenId.employeeNo !== identity.employeeNo) {
      throw new ApiError(409, "飞书账号与工号绑定关系冲突，请联系系统管理员");
    }
    return prisma.user.update({
      where: { id: byOpenId.id },
      data: {
        name: identity.name || byOpenId.name,
        feishuUnionId: identity.unionId,
        lastLoginAt: new Date(),
      },
    });
  }

  // 2. 按 employeeNo 查找并绑定 openId（employeeNo 是业务身份唯一键）
  const byEmployeeNo = await prisma.user.findUnique({
    where: { employeeNo: identity.employeeNo },
  });
  if (byEmployeeNo) {
    if (
      byEmployeeNo.feishuOpenId &&
      byEmployeeNo.feishuOpenId !== identity.openId
    ) {
      throw new ApiError(409, "该工号已绑定其他飞书账号，请联系系统管理员");
    }
    return prisma.user.update({
      where: { id: byEmployeeNo.id },
      data: {
        feishuOpenId: identity.openId,
        feishuUnionId: identity.unionId,
        name: identity.name || byEmployeeNo.name,
        lastLoginAt: new Date(),
      },
    });
  }

  // 3. 首次登录：创建用户
  return prisma.user.create({
    data: {
      employeeNo: identity.employeeNo,
      name: identity.name || identity.employeeNo,
      feishuOpenId: identity.openId,
      feishuUnionId: identity.unionId,
      lastLoginAt: new Date(),
    },
  });
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
}
