-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('SYSTEM_ADMIN', 'USER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "feishuOpenId" TEXT,
    "feishuUnionId" TEXT,
    "employeeNo" TEXT,
    "name" TEXT NOT NULL,
    "systemRole" "SystemRole" NOT NULL DEFAULT 'USER',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_feishuOpenId_key" ON "User"("feishuOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeNo_key" ON "User"("employeeNo");
