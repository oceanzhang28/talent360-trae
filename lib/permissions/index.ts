import type { NextRequest } from "next/server";
import type { Project, User } from "@/app/generated/prisma/client";
import { getCurrentUser } from "@/modules/auth/service";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "./errors";

export { ApiError } from "./errors";

/**
 * 权限中间件（技术文档第 47 节）。
 * 所有项目数据访问必须在服务端调用这些守卫，禁止用前端 if (role) 代替。
 *
 * requireReviewerTask(taskId)     → Sprint 5 引入 ReviewTask 访问控制后实现
 */

/** 要求已登录，否则抛出 401 */
export async function requireLogin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError(401, "未登录或登录已过期");
  }
  return user;
}

/** 要求系统管理员；可传入已加载的 user 避免重复查询，否则抛出 403 */
export async function requireSystemAdmin(user?: User): Promise<User> {
  const current = user ?? (await requireLogin());
  if (current.systemRole !== "SYSTEM_ADMIN") {
    throw new ApiError(403, "需要系统管理员权限");
  }
  return current;
}

/**
 * 要求项目管理员（系统管理员天然拥有所有项目权限）。
 * 返回未删除的项目；未登录 401、项目不存在 404、无权限 403。
 */
export async function requireProjectAdmin(
  projectId: string,
  user?: User,
): Promise<Project> {
  const current = user ?? (await requireLogin());
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });
  if (!project) {
    throw new ApiError(404, "项目不存在");
  }
  if (current.systemRole !== "SYSTEM_ADMIN") {
    const admin = await prisma.projectAdmin.findUnique({
      where: { projectId_userId: { projectId, userId: current.id } },
      select: { id: true },
    });
    if (!admin) {
      throw new ApiError(403, "需要项目管理员权限");
    }
  }
  return project;
}

function apiErrorToResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(
      {
        error: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      { status: err.status },
    );
  }
  // 注意：不打印请求体、token 等敏感内容（AGENTS 铁律 10）
  console.error(
    "[api] unhandled error:",
    err instanceof Error ? err.message : err,
  );
  return Response.json({ error: "服务器内部错误" }, { status: 500 });
}

/**
 * Route Handler 统一包装：捕获 ApiError 转换为对应状态码响应。
 * 用法：export const GET = withApi(async (req, ctx) => { ... })
 */
export function withApi<C = unknown>(
  handler: (req: NextRequest, ctx: C) => Promise<Response>,
): (req: NextRequest, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return apiErrorToResponse(err);
    }
  };
}
