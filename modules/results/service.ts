import type { RelationType, User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, requireProjectAdmin } from "@/lib/permissions";
import { syncStatus } from "@/modules/projects/service";
import {
  computeCompletion,
  type CompletionRate,
  type CompletionResult,
} from "@/modules/scoring";

/**
 * 进度看板与结果后台服务（PRD 第 30、36~38 节 / 技术文档第 34~35 节）。
 *
 * - 进度：项目总体 + 按评价人（催办）+ 按被评人分关系完成表；复用 computeCompletion
 * - 结果：只读 ResultSnapshot（冻结后固定，业务表变化不影响）；维度/题目名称
 *   从问卷读取（问卷在首次提交后锁定，结构稳定）
 * - 评价人实名明细：仅 HR 端（requireProjectAdmin），正式报告不显示姓名（PRD 第 39 节）
 */

export const RELATION_LABELS: Record<RelationType, string> = {
  SELF: "自评",
  MANAGER: "上级",
  PEER: "平级",
  SUBORDINATE: "下级",
};

export const RELATION_ORDER: RelationType[] = [
  "SELF",
  "MANAGER",
  "PEER",
  "SUBORDINATE",
];

/** 结果数据可读状态：冻结后（含归档历史项目） */
const RESULT_STATUSES = new Set(["FROZEN", "ARCHIVED"]);

// ---------- 进度看板（PRD 第 30 节） ----------

export type RateDTO = {
  expected: number;
  submitted: number;
  /** submitted / expected（0~1），无任务时 null；展示层格式化为百分比 */
  rate: number | null;
};

export type RevieweeProgressDTO = {
  personId: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  grade: string | null;
  self: { done: boolean } | null;
  manager: RateDTO;
  peer: RateDTO;
  subordinate: RateDTO;
  total: RateDTO;
};

export type ReviewerProgressDTO = {
  employeeNo: string;
  name: string;
  department: string | null;
  self: RateDTO;
  manager: RateDTO;
  peer: RateDTO;
  subordinate: RateDTO;
  total: RateDTO;
  remaining: number;
};

export type ProgressDTO = {
  project: {
    id: string;
    name: string;
    status: string;
    endAt: string | null;
    frozenAt: string | null;
  };
  overall: RateDTO;
  relations: {
    manager: RateDTO;
    peer: RateDTO;
    subordinate: RateDTO;
    self: RateDTO & { done: boolean };
  };
  byReviewee: RevieweeProgressDTO[];
  byReviewer: ReviewerProgressDTO[];
};

function toRateDTO(rate: CompletionRate): RateDTO {
  return {
    expected: rate.expected,
    submitted: rate.submitted,
    rate: rate.rate === null ? null : rate.rate.toNumber(),
  };
}

function ratesOf(completion: CompletionResult) {
  return {
    self: { ...toRateDTO(completion.self), done: completion.self.done },
    manager: toRateDTO(completion.manager),
    peer: toRateDTO(completion.peer),
    subordinate: toRateDTO(completion.subordinate),
    total: toRateDTO(completion.total),
  };
}

/** 项目进度：总体 + 分关系 + 按被评人 + 按评价人（HR 视角） */
export async function getProjectProgress(
  projectId: string,
  user: User,
): Promise<ProgressDTO> {
  const project = await syncStatus(await requireProjectAdmin(projectId, user));
  const relations = await prisma.reviewRelation.findMany({
    where: { projectId, active: true },
    include: {
      reviewee: {
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          position: true,
          grade: true,
        },
      },
      reviewer: { select: { employeeNo: true, name: true, department: true } },
      tasks: { select: { status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const taskStatuses = relations.map(
    (rel) =>
      ({
        relationType: rel.relationType,
        status: (rel.tasks[0]?.status ?? "NOT_STARTED") as
          "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED",
      }) as const,
  );

  // 按被评人 / 按评价人分组（完成率复用评分模块的 computeCompletion）
  type TaskItem = { relationType: RelationType; status: string };
  const byReviewee = new Map<
    string,
    {
      reviewee: {
        id: string;
        employeeNo: string;
        name: string;
        department: string | null;
        position: string | null;
        grade: string | null;
      };
      tasks: TaskItem[];
    }
  >();
  const byReviewer = new Map<
    string,
    {
      reviewer: { employeeNo: string; name: string; department: string | null };
      tasks: Array<{ relationType: RelationType; status: string }>;
    }
  >();

  for (const rel of relations) {
    const status = rel.tasks[0]?.status ?? "NOT_STARTED";
    let revieweeEntry = byReviewee.get(rel.reviewee.id);
    if (!revieweeEntry) {
      revieweeEntry = { reviewee: rel.reviewee, tasks: [] };
      byReviewee.set(rel.reviewee.id, revieweeEntry);
    }
    revieweeEntry.tasks.push({ relationType: rel.relationType, status });

    const reviewerKey = rel.reviewer.employeeNo;
    let reviewerEntry = byReviewer.get(reviewerKey);
    if (!reviewerEntry) {
      reviewerEntry = { reviewer: rel.reviewer, tasks: [] };
      byReviewer.set(reviewerKey, reviewerEntry);
    }
    reviewerEntry.tasks.push({ relationType: rel.relationType, status });
  }

  const completionOf = (tasks: TaskItem[]) =>
    computeCompletion(
      tasks.map((t) => ({
        relationType: t.relationType,
        status: t.status as
          "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED",
      })),
    );

  const revieweeProgress: RevieweeProgressDTO[] = Array.from(
    byReviewee.values(),
  )
    .map(({ reviewee, tasks }) => {
      const rates = ratesOf(completionOf(tasks));
      return {
        personId: reviewee.id,
        employeeNo: reviewee.employeeNo,
        name: reviewee.name,
        department: reviewee.department,
        position: reviewee.position,
        grade: reviewee.grade,
        self: rates.self.expected > 0 ? { done: rates.self.done } : null,
        manager: rates.manager,
        peer: rates.peer,
        subordinate: rates.subordinate,
        total: rates.total,
      };
    })
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const reviewerProgress: ReviewerProgressDTO[] = Array.from(
    byReviewer.values(),
  )
    .map(({ reviewer, tasks }) => {
      const rates = ratesOf(completionOf(tasks));
      return {
        employeeNo: reviewer.employeeNo,
        name: reviewer.name,
        department: reviewer.department,
        self: rates.self,
        manager: rates.manager,
        peer: rates.peer,
        subordinate: rates.subordinate,
        total: rates.total,
        remaining: rates.total.expected - rates.total.submitted,
      };
    })
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const overall = ratesOf(computeCompletion(taskStatuses));

  return {
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      endAt: project.endAt?.toISOString() ?? null,
      frozenAt: project.frozenAt?.toISOString() ?? null,
    },
    overall: overall.total,
    relations: {
      manager: overall.manager,
      peer: overall.peer,
      subordinate: overall.subordinate,
      self: overall.self,
    },
    byReviewee: revieweeProgress,
    byReviewer: reviewerProgress,
  };
}

// ---------- 结果后台（PRD 第 38 节） ----------

function dec(value: import("decimal.js").Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

export type ResultRevieweeDTO = {
  personId: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  grade: string | null;
  totalScore: number | null;
  selfScore: number | null;
  managerScore: number | null;
  peerScore: number | null;
  subordinateScore: number | null;
  expectedCount: number;
  submittedCount: number;
  completionRate: number | null;
};

export type ResultsListDTO = {
  frozen: boolean;
  frozenAt: string | null;
  overall: { expected: number; submitted: number; rate: number | null };
  reviewees: ResultRevieweeDTO[];
};

/** 被评人结果列表：只读 ResultSnapshot（未冻结返回空 + frozen=false，UI 引导先看进度） */
export async function listProjectResults(
  projectId: string,
  user: User,
): Promise<ResultsListDTO> {
  const project = await requireProjectAdmin(projectId, user);
  if (!RESULT_STATUSES.has(project.status)) {
    return {
      frozen: false,
      frozenAt: null,
      overall: { expected: 0, submitted: 0, rate: null },
      reviewees: [],
    };
  }
  const snapshots = await prisma.resultSnapshot.findMany({
    where: { projectId },
    include: {
      reviewee: {
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          position: true,
          grade: true,
        },
      },
    },
  });
  const reviewees = snapshots
    .map((s): ResultRevieweeDTO => ({
      personId: s.reviewee.id,
      employeeNo: s.reviewee.employeeNo,
      name: s.reviewee.name,
      department: s.reviewee.department,
      position: s.reviewee.position,
      grade: s.reviewee.grade,
      totalScore: dec(s.totalScore),
      selfScore: dec(s.selfScore),
      managerScore: dec(s.managerScore),
      peerScore: dec(s.peerScore),
      subordinateScore: dec(s.subordinateScore),
      expectedCount: s.expectedCount,
      submittedCount: s.submittedCount,
      completionRate: dec(s.completionRate),
    }))
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const expected = reviewees.reduce((acc, r) => acc + r.expectedCount, 0);
  const submitted = reviewees.reduce((acc, r) => acc + r.submittedCount, 0);
  return {
    frozen: true,
    frozenAt: project.frozenAt?.toISOString() ?? null,
    overall: {
      expected,
      submitted,
      rate: expected === 0 ? null : submitted / expected,
    },
    reviewees,
  };
}

// ---------- 结果下钻（一级维度 → 二级维度 → 题目得分） ----------

export type ResultQuestionNodeDTO = {
  questionId: string;
  code: string;
  title: string;
  /** RATING 题平均分；可见但无有效数据为 null；TEXT 题不在此列 */
  score: number | null;
};

export type ResultDimensionNodeDTO = {
  dimensionId: string;
  name: string;
  /** 配置权重（百分数） */
  weight: number;
  score: number | null;
  children: ResultDimensionNodeDTO[];
  questions: ResultQuestionNodeDTO[];
};

export type ResultRelationDTO = {
  relation: RelationType;
  score: number | null;
  dimensions: ResultDimensionNodeDTO[];
};

export type ResultDetailDTO = {
  frozen: boolean;
  frozenAt: string | null;
  reviewee: ResultRevieweeDTO;
  relations: ResultRelationDTO[];
};

/** 题目/维度对关系是否可见（与评价端过滤规则一致：题目未覆盖时继承维度规则） */
function questionVisible(
  q: {
    overrideRelationRules: boolean;
    applicableSelf: boolean;
    applicableManager: boolean;
    applicablePeer: boolean;
    applicableSubordinate: boolean;
  },
  relation: RelationType,
): boolean {
  if (!q.overrideRelationRules) return true;
  return relation === "SELF"
    ? q.applicableSelf
    : relation === "MANAGER"
      ? q.applicableManager
      : relation === "PEER"
        ? q.applicablePeer
        : q.applicableSubordinate;
}

function dimensionVisible(
  d: {
    applicableSelf: boolean;
    applicableManager: boolean;
    applicablePeer: boolean;
    applicableSubordinate: boolean;
  },
  relation: RelationType,
): boolean {
  return relation === "SELF"
    ? d.applicableSelf
    : relation === "MANAGER"
      ? d.applicableManager
      : relation === "PEER"
        ? d.applicablePeer
        : d.applicableSubordinate;
}

/** 单个被评人结果下钻：快照得分 + 问卷结构（问卷已锁定，读取名称/树/权重） */
export async function getResultDetail(
  projectId: string,
  personId: string,
  user: User,
): Promise<ResultDetailDTO> {
  const project = await requireProjectAdmin(projectId, user);
  const snapshot = await prisma.resultSnapshot.findUnique({
    where: {
      projectId_revieweePersonId: { projectId, revieweePersonId: personId },
    },
    include: {
      reviewee: {
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          position: true,
          grade: true,
        },
      },
    },
  });
  if (!snapshot) {
    throw new ApiError(404, "该被评人没有结果快照（项目可能未冻结）");
  }

  const questionnaire = await prisma.questionnaire.findUnique({
    where: { projectId },
  });
  if (!questionnaire) {
    throw new ApiError(404, "项目问卷不存在");
  }
  const [dimensions, questions, dimRows, questionRows] = await Promise.all([
    prisma.dimension.findMany({
      where: { questionnaireId: questionnaire.id },
      orderBy: { order: "asc" },
    }),
    prisma.question.findMany({
      where: { dimension: { questionnaireId: questionnaire.id } },
      orderBy: { order: "asc" },
    }),
    prisma.resultDimension.findMany({
      where: { resultSnapshotId: snapshot.id },
    }),
    prisma.resultQuestion.findMany({
      where: { resultSnapshotId: snapshot.id },
    }),
  ]);

  const dimScore = new Map(
    dimRows.map((r) => [`${r.relationType}|${r.dimensionId}`, dec(r.score)]),
  );
  const questionScore = new Map(
    questionRows.map((r) => [
      `${r.relationType}|${r.questionId}`,
      dec(r.score),
    ]),
  );

  const relationScore: Record<RelationType, number | null> = {
    SELF: dec(snapshot.selfScore),
    MANAGER: dec(snapshot.managerScore),
    PEER: dec(snapshot.peerScore),
    SUBORDINATE: dec(snapshot.subordinateScore),
  };

  const childrenByParent = new Map<string, typeof dimensions>();
  for (const d of dimensions) {
    if (d.parentId === null) continue;
    const list = childrenByParent.get(d.parentId) ?? [];
    list.push(d);
    childrenByParent.set(d.parentId, list);
  }
  const questionsByDim = new Map<string, typeof questions>();
  for (const q of questions) {
    const list = questionsByDim.get(q.dimensionId) ?? [];
    list.push(q);
    questionsByDim.set(q.dimensionId, list);
  }

  const relations: ResultRelationDTO[] = RELATION_ORDER.map((relation) => ({
    relation,
    score: relationScore[relation],
    dimensions: dimensions
      .filter((d) => d.parentId === null && dimensionVisible(d, relation))
      .map((root) => ({
        dimensionId: root.id,
        name: root.name,
        weight: root.weight.toNumber(),
        score: dimScore.get(`${relation}|${root.id}`) ?? null,
        children: (childrenByParent.get(root.id) ?? [])
          .filter((c) => dimensionVisible(c, relation))
          .map((child) => ({
            dimensionId: child.id,
            name: child.name,
            weight: child.weight.toNumber(),
            score: dimScore.get(`${relation}|${child.id}`) ?? null,
            children: [],
            questions: (questionsByDim.get(child.id) ?? [])
              .filter(
                (q) => q.type === "RATING" && questionVisible(q, relation),
              )
              .map((q) => ({
                questionId: q.id,
                code: q.code,
                title: q.title,
                score: questionScore.get(`${relation}|${q.id}`) ?? null,
              })),
          })),
        questions: (questionsByDim.get(root.id) ?? [])
          .filter((q) => q.type === "RATING" && questionVisible(q, relation))
          .map((q) => ({
            questionId: q.id,
            code: q.code,
            title: q.title,
            score: questionScore.get(`${relation}|${q.id}`) ?? null,
          })),
      })),
  }));

  return {
    frozen: true,
    frozenAt: project.frozenAt?.toISOString() ?? null,
    reviewee: {
      personId: snapshot.reviewee.id,
      employeeNo: snapshot.reviewee.employeeNo,
      name: snapshot.reviewee.name,
      department: snapshot.reviewee.department,
      position: snapshot.reviewee.position,
      grade: snapshot.reviewee.grade,
      totalScore: dec(snapshot.totalScore),
      selfScore: dec(snapshot.selfScore),
      managerScore: dec(snapshot.managerScore),
      peerScore: dec(snapshot.peerScore),
      subordinateScore: dec(snapshot.subordinateScore),
      expectedCount: snapshot.expectedCount,
      submittedCount: snapshot.submittedCount,
      completionRate: dec(snapshot.completionRate),
    },
    relations,
  };
}

// ---------- 评价人实名明细（仅 HR 端，PRD 第 38 节） ----------

export type ReviewerAnswerDTO = {
  questionId: string;
  code: string;
  title: string;
  type: "RATING" | "TEXT";
  score: number | null;
  textValue: string | null;
};

export type ReviewerDetailDTO = {
  relationType: RelationType;
  reviewer: { employeeNo: string; name: string; department: string | null };
  submittedAt: string;
  answers: ReviewerAnswerDTO[];
};

export type ReviewerDetailsDTO = {
  reviewee: { employeeNo: string; name: string };
  reviewers: ReviewerDetailDTO[];
};

/**
 * 每位评价人的实名评价明细（HR 端专用）：
 * 读取当前有效 Submission（invalidatedAt=null）的答案快照，含开放题原文。
 * 冻结后提交/关系均被锁定，数据与结果快照一致；正式报告不显示姓名（PRD 第 39 节）。
 */
export async function listReviewerDetails(
  projectId: string,
  personId: string,
  user: User,
): Promise<ReviewerDetailsDTO> {
  const project = await requireProjectAdmin(projectId, user);
  if (!RESULT_STATUSES.has(project.status)) {
    throw new ApiError(409, "项目未冻结，暂无正式结果明细");
  }
  const reviewee = await prisma.projectPerson.findUnique({
    where: { id: personId },
    select: { employeeNo: true, name: true, projectId: true },
  });
  if (!reviewee || reviewee.projectId !== projectId) {
    throw new ApiError(404, "被评人不存在");
  }

  const relations = await prisma.reviewRelation.findMany({
    where: { projectId, revieweePersonId: personId, active: true },
    include: {
      reviewer: { select: { employeeNo: true, name: true, department: true } },
      tasks: {
        include: {
          submissions: {
            where: { invalidatedAt: null },
            include: {
              answers: {
                include: {
                  question: {
                    select: {
                      code: true,
                      title: true,
                      type: true,
                      order: true,
                      dimension: { select: { order: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const reviewers: ReviewerDetailDTO[] = [];
  for (const rel of relations) {
    const submission = rel.tasks[0]?.submissions[0];
    if (!submission) continue;
    reviewers.push({
      relationType: rel.relationType,
      reviewer: rel.reviewer,
      submittedAt: submission.submittedAt.toISOString(),
      answers: submission.answers
        .slice()
        .sort(
          (a, b) =>
            a.question.dimension.order - b.question.dimension.order ||
            a.question.order - b.question.order,
        )
        .map((a) => ({
          questionId: a.questionId,
          code: a.question.code,
          title: a.question.title,
          type: a.question.type,
          score: a.score === null ? null : a.score.toNumber(),
          textValue: a.textValue,
        })),
    });
  }
  // 关系顺序稳定：SELF → MANAGER → PEER → SUBORDINATE，同关系按工号
  reviewers.sort((a, b) => {
    const ra = RELATION_ORDER.indexOf(a.relationType);
    const rb = RELATION_ORDER.indexOf(b.relationType);
    return ra !== rb
      ? ra - rb
      : a.reviewer.employeeNo.localeCompare(b.reviewer.employeeNo);
  });

  return { reviewee, reviewers };
}
