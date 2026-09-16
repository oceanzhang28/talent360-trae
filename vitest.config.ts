import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // 单元测试统一使用固定密钥，保证可复现（覆盖 .env 中的开发密钥）
    env: {
      SESSION_SECRET: "vitest-session-secret-0123456789abcdef",
      // 显式注入（dotenv 已在顶部加载），避免高负载时 worker 进程 env 继承竞态导致集成测试被误 skip
      ...(process.env.DATABASE_URL
        ? { DATABASE_URL: process.env.DATABASE_URL }
        : {}),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
