import type { Project } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import {
  computeCompletion,
  computeScores,
  type CompletionResult,
  type ScoringDimension,
  type ScoringQuestion,
  type ScoringRelation,
  type ScoringResult,
  type ScoringSubmission,
} from "@/modules/scoring";
import type Decimal from "decimal.js";

/**
 * 结果快照生成（技术文档第 22~24、35 节 / PRD 第 36~37 节）。
 *
 * 冻结时：查询所有有效 Submission（invalidatedAt=null）→ 执行评分引擎 →
 * 生成 ResultSnapshot + ResultDimension + ResultQuestion → 落库整体替换。
 * 允许未 100% 完成冻结（PRD 第 36 节），完成度随快照保存。
 */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type SnapshotDimensionRow = {
  dimensionId: string;
  relationType: ScoringRelation;
  score: Decimal;
};

export type SnapshotQuestionRow = {
  questionId: string;
  relationType: ScoringRelation;
  score: Decimal;
};

export type SnapshotDraft = {
  revieweePersonId: string;
  totalScore: Decimal | null;
  selfScore: Decimal | null;
  managerScore: Decimal | null;
  peerScore: Decimal | null;
  subordinateScore: Decimal | null;
  expectedCount: number;
  submittedCount: number;
  completionRate: Decimal | null;
  dimensions: SnapshotDimensionRow[];
  questions: SnapshotQuestionRow[];
};

/** 评分结果 → 快照草稿（纯函数，便于单元测试）；无得分的维度/题目行直接剔除 */
export function toSnapshotDraft(
  revieweePersonId: string,
  result: ScoringResult,
  completion: CompletionResult,
): SnapshotDraft {
  const relationScore = (relation: ScoringRelation) =>
    result.relations.find((r) => r.relation === relation)?.score ?? null;

  const dimensions: SnapshotDimensionRow[] = [];
  const questions: SnapshotQuestionRow[] = [];
  for (const relation of result.relations) {
    for (const root of relation.dimensions) {
      if (root.score !== null) {
        dimensions.push({
          dimensionId: root.dimensionId,
          relationType: relation.relation,
          score: root.score,
        });
      }
      for (const child of root.children) {
        if (child.score !== null) {
          dimensions.push({
            dimensionId: child.dimensionId,
            relationType: relation.relation,
            score: child.score,
          });
        }
      }
      const allQuestions = [
        ...root.questions,
        ...root.children.flatMap((c) => c.questions),
      ];
      for (const q of allQuestions) {
        if (q.average !== null) {
          questions.push({
            questionId: q.questionId,
            relationType: relation.relation,
            score: q.average,
          });
        }
      }
    }
  }

  return {
    revieweePersonId,
    totalScore: result.total360,
    selfScore: relationScore("SELF"),
    managerScore: relationScore("MANAGER"),
    peerScore: relationScore("PEER"),
    subordinateScore: relationScore("SUBORDINATE"),
    expectedCount: completion.total.expected,
    submittedCount: completion.total.submitted,
    completionRate: completion.total.rate,
    dimensions,
    questions,
  };
}

export type FreezeSummary = {
  snapshotCount: number;
  expected: number;
  submitted: number;
  relations: {
    manager: { expected: number; submitted: number };
    peer: { expected: number; submitted: number };
    subordinate: { expected: number; submitted: number };
    self: { expected: number; submitted: number };
  };
};

/**
 * 构建并持久化全部被评人的结果快照（冻结事务内调用，整体替换旧快照）。
 * 输入提交均为当前有效版本（invalidatedAt=null，退回重评后旧版本不参与）。
 */
export async function buildAndPersistSnapshots(
  tx: Tx,
  project: Project,
): Promise<FreezeSummary> {
  const questionnaire = await tx.questionnaire.findUnique({
    where: { projectId: project.id },
  });
  if (!questionnaire) {
    throw new ApiError(400, "项目问卷不存在，无法冻结");
  }

  const [dimensions, questions, relations] = await Promise.all([
    tx.dimension.findMany({ where: { questionnaireId: questionnaire.id } }),
    tx.question.findMany({
      where: { dimension: { questionnaireId: questionnaire.id } },
    }),
    tx.reviewRelation.findMany({
      where: { projectId: project.id, active: true },
      include: {
        reviewee: { select: { id: true, employeeNo: true } },
        tasks: {
          select: {
            status: true,
            submissions: {
              where: { invalidatedAt: null },
              select: {
                answers: { select: { questionId: true, score: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const scoringDimensions: ScoringDimension[] = dimensions.map((d) => ({
    id: d.id,
    parentId: d.parentId,
    weight: d.weight,
    applicableSelf: d.applicableSelf,
    applicableManager: d.applicableManager,
    applicablePeer: d.applicablePeer,
    applicableSubordinate: d.applicableSubordinate,
  }));
  const scoringQuestions: ScoringQuestion[] = questions.map((q) => ({
    id: q.id,
    dimensionId: q.dimensionId,
    weight: q.weight,
    overrideRelationRules: q.overrideRelationRules,
    applicableSelf: q.applicableSelf,
    applicableManager: q.applicableManager,
    applicablePeer: q.applicablePeer,
    applicableSubordinate: q.applicableSubordinate,
  }));

  // 按被评人分组（有效关系 + 任务状态 + 当前有效提交）
  const byReviewee = new Map<
    string,
    {
      employeeNo: string;
      relationTypes: ScoringRelation[];
      statuses: string[];
      submissions: ScoringSubmission[];
    }
  >();
  for (const rel of relations) {
    const entry = byReviewee.get(rel.reviewee.id) ?? {
      employeeNo: rel.reviewee.employeeNo,
      relationTypes: [],
      statuses: [],
      submissions: [],
    };
    const task = rel.tasks[0];
    entry.relationTypes.push(rel.relationType);
    entry.statuses.push(task?.status ?? "NOT_STARTED");
    const submission = task?.submissions[0];
    if (submission) {
      const scores: Record<string, Decimal.Value> = {};
      for (const a of submission.answers) {
        if (a.score !== null) scores[a.questionId] = a.score;
      }
      entry.submissions.push({ relationType: rel.relationType, scores });
    }
    byReviewee.set(rel.reviewee.id, entry);
  }

  // 逐个被评人执行评分引擎 + 完成率，生成快照草稿（按工号稳定排序）
  const drafts: SnapshotDraft[] = [];
  const revieweeIds = Array.from(byReviewee.keys());
  const revieweeNoById = new Map(
    Array.from(byReviewee.entries()).map(([id, e]) => [id, e.employeeNo]),
  );
  revieweeIds.sort((a, b) =>
    (revieweeNoById.get(a) ?? "").localeCompare(revieweeNoById.get(b) ?? ""),
  );
  for (const personId of revieweeIds) {
    const entry = byReviewee.get(personId)!;
    const result = computeScores({
      dimensions: scoringDimensions,
      questions: scoringQuestions,
      submissions: entry.submissions,
      weights: {
        manager: project.managerWeight,
        peer: project.peerWeight,
        subordinate: project.subordinateWeight,
      },
    });
    const completion = computeCompletion(
      entry.relationTypes.map((relationType, i) => ({
        relationType,
        status: entry.statuses[i] as
          "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED",
      })),
    );
    drafts.push(toSnapshotDraft(personId, result, completion));
  }

  // 整体替换：先删旧快照（级联删维度/题目行），再批量写入
  await tx.resultSnapshot.deleteMany({ where: { projectId: project.id } });
  if (drafts.length > 0) {
    const created = await tx.resultSnapshot.createManyAndReturn({
      data: drafts.map((d) => ({
        projectId: project.id,
        revieweePersonId: d.revieweePersonId,
        totalScore: d.totalScore,
        selfScore: d.selfScore,
        managerScore: d.managerScore,
        peerScore: d.peerScore,
        subordinateScore: d.subordinateScore,
        expectedCount: d.expectedCount,
        submittedCount: d.submittedCount,
        completionRate: d.completionRate,
      })),
    });
    const snapshotIdByPerson = new Map(
      created.map((s) => [s.revieweePersonId, s.id]),
    );
    const dimensionRows = drafts.flatMap((d) =>
      d.dimensions.map((row) => ({
        ...row,
        resultSnapshotId: snapshotIdByPerson.get(d.revieweePersonId)!,
      })),
    );
    if (dimensionRows.length > 0) {
      await tx.resultDimension.createMany({ data: dimensionRows });
    }
    const questionRows = drafts.flatMap((d) =>
      d.questions.map((row) => ({
        ...row,
        resultSnapshotId: snapshotIdByPerson.get(d.revieweePersonId)!,
      })),
    );
    if (questionRows.length > 0) {
      await tx.resultQuestion.createMany({ data: questionRows });
    }
  }

  // 冻结汇总（审计 + 完整性警告）
  const summary: FreezeSummary = {
    snapshotCount: drafts.length,
    expected: 0,
    submitted: 0,
    relations: {
      manager: { expected: 0, submitted: 0 },
      peer: { expected: 0, submitted: 0 },
      subordinate: { expected: 0, submitted: 0 },
      self: { expected: 0, submitted: 0 },
    },
  };
  for (const rel of relations) {
    const task = rel.tasks[0];
    const submitted = task?.status === "SUBMITTED";
    summary.expected += 1;
    if (submitted) summary.submitted += 1;
    const bucket =
      rel.relationType === "SELF"
        ? summary.relations.self
        : rel.relationType === "MANAGER"
          ? summary.relations.manager
          : rel.relationType === "PEER"
            ? summary.relations.peer
            : summary.relations.subordinate;
    bucket.expected += 1;
    if (submitted) bucket.submitted += 1;
  }
  return summary;
}
