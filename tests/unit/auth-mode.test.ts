import { describe, expect, it } from "vitest";
import { assertAuthModeSafe } from "@/instrumentation";

/**
 * 启动环境断言：生产环境误配 AUTH_MODE=mock 时必须拒绝启动
 * （mock 登录只校验工号+姓名并自动建号，误配等于任意工号可登录）。
 */
describe("assertAuthModeSafe", () => {
  it("生产 + mock：抛错拒绝启动", () => {
    expect(() =>
      assertAuthModeSafe({ NODE_ENV: "production", AUTH_MODE: "mock" }),
    ).toThrow(/AUTH_MODE=mock/);
  });

  it("生产 + feishu：放行", () => {
    expect(() =>
      assertAuthModeSafe({ NODE_ENV: "production", AUTH_MODE: "feishu" }),
    ).not.toThrow();
  });

  it("开发 + mock：放行", () => {
    expect(() =>
      assertAuthModeSafe({ NODE_ENV: "development", AUTH_MODE: "mock" }),
    ).not.toThrow();
  });

  it("AUTH_MODE 未配置：放行（按 feishu 路径处理，登录时另有配置校验）", () => {
    expect(() => assertAuthModeSafe({ NODE_ENV: "production" })).not.toThrow();
  });
});
