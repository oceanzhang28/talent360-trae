-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('SELF', 'MANAGER', 'PEER', 'SUBORDINATE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('RETURN_REVIEW', 'DELETE_RELATION', 'CHANGE_RELATION', 'FREEZE_PROJECT', 'UNFREEZE_PROJECT', 'EXPORT_RESULTS', 'SYNC_FEISHU', 'DELETE_PROJECT', 'RESTORE_PROJECT');

-- DropIndex
DROP INDEX "Project_status_idx";

-- CreateTable
CREATE TABLE "ProjectPerson" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "grade" TEXT,
    "feishuOpenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRelation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revieweePersonId" TEXT NOT NULL,
    "reviewerPersonId" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "currentSubmissionVersion" INTEGER,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "projectId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectPerson_projectId_idx" ON "ProjectPerson"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPerson_projectId_employeeNo_key" ON "ProjectPerson"("projectId", "employeeNo");

-- CreateIndex
CREATE INDEX "ReviewRelation_projectId_idx" ON "ReviewRelation"("projectId");

-- CreateIndex
CREATE INDEX "ReviewRelation_reviewerPersonId_idx" ON "ReviewRelation"("reviewerPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRelation_projectId_revieweePersonId_reviewerPersonId_key" ON "ReviewRelation"("projectId", "revieweePersonId", "reviewerPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewTask_relationId_key" ON "ReviewTask"("relationId");

-- CreateIndex
CREATE INDEX "ReviewTask_projectId_idx" ON "ReviewTask"("projectId");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_idx" ON "AuditLog"("projectId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ProjectPerson" ADD CONSTRAINT "ProjectPerson_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRelation" ADD CONSTRAINT "ReviewRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRelation" ADD CONSTRAINT "ReviewRelation_revieweePersonId_fkey" FOREIGN KEY ("revieweePersonId") REFERENCES "ProjectPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRelation" ADD CONSTRAINT "ReviewRelation_reviewerPersonId_fkey" FOREIGN KEY ("reviewerPersonId") REFERENCES "ProjectPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "ReviewRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
