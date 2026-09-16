/**
 * 服务启动钩子（Next.js instrumentation，Next 16 默认启用）：
 * `register()` 在新服务实例就绪前执行一次，此处用于环境安全断言（fail-fast）。
 */

/**
 * 生产环境禁止 `AUTH_MODE=mock`。
 * mock 登录只校验工号与姓名并自动 upsert 用户，一旦误配到生产等于「任意工号即可登录并自动建号」。
 * 抽成纯函数便于单测（见 tests/unit/auth-mode.test.ts）。
 */
export function assertAuthModeSafe(env: {
  NODE_ENV?: string;
  AUTH_MODE?: string;
}): void {
  if (env.NODE_ENV === "production" && env.AUTH_MODE === "mock") {
    throw new Error(
      "生产环境禁止 AUTH_MODE=mock（任意工号即可登录并自动建号），请配置 AUTH_MODE=feishu 后重启",
    );
  }
}

export function register(): void {
  assertAuthModeSafe(process.env);
}
