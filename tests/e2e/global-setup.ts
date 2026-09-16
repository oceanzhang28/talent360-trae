import { execSync } from "node:child_process";

/** E2E 前置：确保数据库已迁移并包含初始系统管理员（00000） */
export default function globalSetup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}
