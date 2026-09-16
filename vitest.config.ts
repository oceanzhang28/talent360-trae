import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // 集成测试文件存在共享 User 工号（模板自带人员），并行 upsert 会触发唯一约束竞态
    fileParallelism: false,
    // 覆盖率（评分引擎验收要求 ≥90%，技术文档第 59 节）
    coverage: {
      provider: "v8",
      include: ["modules/scoring/**"],
    },
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
