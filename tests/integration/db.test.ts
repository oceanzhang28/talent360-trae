import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";

// 无数据库环境（如 CI）自动跳过
describe.skipIf(!process.env.DATABASE_URL)("数据库连接", () => {
  it("Prisma client 可通过 adapter 连接并查询", async () => {
    const count = await prisma.user.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
