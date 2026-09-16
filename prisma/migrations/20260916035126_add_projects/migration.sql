-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ACTIVE', 'CLOSED', 'FROZEN', 'ARCHIVED', 'DELETED');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "questionnaireInstruction" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "selfReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "managerWeight" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "peerWeight" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "subordinateWeight" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "frozenAt" TIMESTAMP(3),
    "frozenBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAdmin" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectScale" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "value" DECIMAL(3,1) NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ProjectScale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "ProjectAdmin_userId_idx" ON "ProjectAdmin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAdmin_projectId_userId_key" ON "ProjectAdmin"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectScale_projectId_value_key" ON "ProjectScale"("projectId", "value");

-- AddForeignKey
ALTER TABLE "ProjectAdmin" ADD CONSTRAINT "ProjectAdmin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAdmin" ADD CONSTRAINT "ProjectAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectScale" ADD CONSTRAINT "ProjectScale_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
