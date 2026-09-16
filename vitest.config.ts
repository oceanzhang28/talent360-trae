import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // 单元测试统一使用固定密钥，保证可复现（覆盖 .env 中的开发密钥）
    env: {
      SESSION_SECRET: "vitest-session-secret-0123456789abcdef",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
