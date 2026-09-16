-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('RATING', 'TEXT');

-- CreateTable
CREATE TABLE "Questionnaire" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "templateName" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Questionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dimension" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "applicableSelf" BOOLEAN NOT NULL DEFAULT true,
    "applicableManager" BOOLEAN NOT NULL DEFAULT true,
    "applicablePeer" BOOLEAN NOT NULL DEFAULT true,
    "applicableSubordinate" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(5,2),
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "overrideRelationRules" BOOLEAN NOT NULL DEFAULT false,
    "applicableSelf" BOOLEAN NOT NULL DEFAULT true,
    "applicableManager" BOOLEAN NOT NULL DEFAULT true,
    "applicablePeer" BOOLEAN NOT NULL DEFAULT true,
    "applicableSubordinate" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Questionnaire_projectId_key" ON "Questionnaire"("projectId");

-- CreateIndex
CREATE INDEX "Questionnaire_isTemplate_idx" ON "Questionnaire"("isTemplate");

-- CreateIndex
CREATE INDEX "Dimension_questionnaireId_idx" ON "Dimension"("questionnaireId");

-- CreateIndex
CREATE INDEX "Dimension_parentId_idx" ON "Dimension"("parentId");

-- CreateIndex
CREATE INDEX "Question_dimensionId_idx" ON "Question"("dimensionId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_dimensionId_code_key" ON "Question"("dimensionId", "code");

-- AddForeignKey
ALTER TABLE "Questionnaire" ADD CONSTRAINT "Questionnaire_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dimension" ADD CONSTRAINT "Dimension_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dimension" ADD CONSTRAINT "Dimension_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Dimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "Dimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;
