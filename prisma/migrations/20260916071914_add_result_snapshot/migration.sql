-- CreateTable
CREATE TABLE "ResultSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revieweePersonId" TEXT NOT NULL,
    "totalScore" DECIMAL(8,6),
    "selfScore" DECIMAL(8,6),
    "managerScore" DECIMAL(8,6),
    "peerScore" DECIMAL(8,6),
    "subordinateScore" DECIMAL(8,6),
    "expectedCount" INTEGER NOT NULL,
    "submittedCount" INTEGER NOT NULL,
    "completionRate" DECIMAL(8,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultDimension" (
    "id" TEXT NOT NULL,
    "resultSnapshotId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL,
    "score" DECIMAL(8,6) NOT NULL,

    CONSTRAINT "ResultDimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultQuestion" (
    "id" TEXT NOT NULL,
    "resultSnapshotId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL,
    "score" DECIMAL(8,6) NOT NULL,

    CONSTRAINT "ResultQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResultSnapshot_projectId_idx" ON "ResultSnapshot"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSnapshot_projectId_revieweePersonId_key" ON "ResultSnapshot"("projectId", "revieweePersonId");

-- CreateIndex
CREATE INDEX "ResultDimension_resultSnapshotId_idx" ON "ResultDimension"("resultSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultDimension_resultSnapshotId_dimensionId_relationType_key" ON "ResultDimension"("resultSnapshotId", "dimensionId", "relationType");

-- CreateIndex
CREATE INDEX "ResultQuestion_resultSnapshotId_idx" ON "ResultQuestion"("resultSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultQuestion_resultSnapshotId_questionId_relationType_key" ON "ResultQuestion"("resultSnapshotId", "questionId", "relationType");

-- AddForeignKey
ALTER TABLE "ResultSnapshot" ADD CONSTRAINT "ResultSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSnapshot" ADD CONSTRAINT "ResultSnapshot_revieweePersonId_fkey" FOREIGN KEY ("revieweePersonId") REFERENCES "ProjectPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultDimension" ADD CONSTRAINT "ResultDimension_resultSnapshotId_fkey" FOREIGN KEY ("resultSnapshotId") REFERENCES "ResultSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultQuestion" ADD CONSTRAINT "ResultQuestion_resultSnapshotId_fkey" FOREIGN KEY ("resultSnapshotId") REFERENCES "ResultSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
