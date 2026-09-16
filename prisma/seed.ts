import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

// seed 独立创建 client（避免依赖 next/headers 上下文的 lib/db/prisma）
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  // 初始系统管理员：工号 00000（可用 npm run db:seed 重复执行，幂等）
  await prisma.user.upsert({
    where: { employeeNo: "00000" },
    update: { systemRole: "SYSTEM_ADMIN" },
    create: {
      employeeNo: "00000",
      name: "系统管理员",
      systemRole: "SYSTEM_ADMIN",
    },
  });
  console.log("✅ 初始系统管理员已就绪（employeeNo: 00000）");
}

main()
  .catch((e) => {
    console.error("seed 失败:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
