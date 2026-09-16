import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/app/generated/prisma/client";
import { ApiError } from "@/lib/permissions/errors";

// 权限守卫依赖 getCurrentUser（内部使用 next/headers，只能在请求上下文调用），此处 mock
vi.mock("@/modules/auth/service", () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from "@/modules/auth/service";
import { requireLogin, requireSystemAdmin, withApi } from "@/lib/permissions";

const mockedGetCurrentUser = vi.mocked(getCurrentUser);

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    feishuOpenId: null,
    feishuUnionId: null,
    employeeNo: "E001",
    name: "测试用户",
    systemRole: "USER",
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

beforeEach(() => {
  mockedGetCurrentUser.mockReset();
});

describe("requireLogin", () => {
  it("未登录抛出 401", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);
    await expect(requireLogin()).rejects.toMatchObject({ status: 401 });
  });

  it("已登录返回用户", async () => {
    const user = buildUser();
    mockedGetCurrentUser.mockResolvedValue(user);
    await expect(requireLogin()).resolves.toBe(user);
  });
});

describe("requireSystemAdmin", () => {
  it("未登录抛出 401", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);
    await expect(requireSystemAdmin()).rejects.toMatchObject({ status: 401 });
  });

  it("普通用户抛出 403", async () => {
    mockedGetCurrentUser.mockResolvedValue(buildUser({ systemRole: "USER" }));
    await expect(requireSystemAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("系统管理员通过", async () => {
    const admin = buildUser({ systemRole: "SYSTEM_ADMIN" });
    mockedGetCurrentUser.mockResolvedValue(admin);
    await expect(requireSystemAdmin()).resolves.toBe(admin);
  });

  it("传入已加载用户时不再查询", async () => {
    const admin = buildUser({ systemRole: "SYSTEM_ADMIN" });
    await expect(requireSystemAdmin(admin)).resolves.toBe(admin);
    expect(mockedGetCurrentUser).not.toHaveBeenCalled();
  });
});

describe("withApi", () => {
  it("ApiError 转换为对应状态码响应", async () => {
    const handler = withApi(async () => {
      throw new ApiError(403, "需要系统管理员权限");
    });
    const res = await handler(
      new Request("http://localhost/x") as never,
      {} as never,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("需要系统管理员权限");
  });

  it("未知错误转换为 500 且不泄露细节", async () => {
    const handler = withApi(async () => {
      throw new Error("database password is xxx");
    });
    const res = await handler(
      new Request("http://localhost/x") as never,
      {} as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("服务器内部错误");
    expect(JSON.stringify(body)).not.toContain("xxx");
  });

  it("正常返回原响应", async () => {
    const handler = withApi(async () => Response.json({ ok: true }));
    const res = await handler(
      new Request("http://localhost/x") as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
