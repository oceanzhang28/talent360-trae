import type {
  Project,
  Questionnaire,
  RelationType,
  ReviewTask,
  TaskStatus,
  User,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  ApiError,
  requireProjectAdmin,
  requireReviewerTask,
} from "@/lib/permissions";
import { writeAudit } from "@/modules/audit/service";
import { syncStatus } from "@/modules/projects/service";
import {
  filterTreeForRelation,
  findMissingRequired,
  flattenQuestions,
  validateDraftAnswers,
  DraftValidationError,
  type RawDimension,
  type TaskDimension,
  type TaskQuestion,
} from "./validate";

/**
 * 评价任务服务（技术文档第 18~21、42、43 节 / PRD 第 21~24 节）。
 *
 * - 草稿（DraftAnswer）仅评价人本人可读写（铁律 4：任何 HR 接口不暴露草稿）
 * - 提交生成 Submission 版本快照；HR 退回后可重交，历史版本保留（invalidatedAt 标记）
 * - 项目首次正式提交时设置问卷 lockedAt（Sprint 3 遗留 TODO）
 * - 填写/提交窗口：仅项目 ACTIVE（CLOSED 后只读）
 */

const RELATION_ORDER: RelationType[] = [
  "SELF",
  "MANAGER",
  "PEER",
  "SUBORDINATE",
];

export const RELATION_LABELS: Record<RelationType, string> = {
  SELF: "自评",
  MANAGER: "上级",
  PEER: "平级",
  SUBORDINATE: "下级",
};

/** 员工可见任务的项目状态：测评开始后才可见（含截止/冻结后的只读查看） */
const VISIBLE_PROJECT_STATUSES = new Set(["ACTIVE", "CLOSED", "FROZEN"]);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ---------- 我的任务列表 ----------

export type MyTaskItem = {
  taskId: string;
  relationType: RelationType;
  status: TaskStatus;
  submittedAt: string | null;
  returnedAt: string | null;
  reviewee: {
    name: string;
    employeeNo: string;
    department: string | null;
    position: string | null;
  };
  project: { id: string; name: string; status: string; endAt: string | null };
};

export type MyTasksDTO = {
  groups: Array<{
    relationType: RelationType;
    label: string;
    tasks: MyTaskItem[];
  }>;
  counts: {
    total: number;
    notStarted: number;
    inProgress: number;
    returned: number;
    submitted: number;
  };
};

/** 当前用户的全部评价任务：按关系分组 + 状态计数（技术文档第 42 节） */
export async function listMyTasks(user: User): Promise<MyTasksDTO> {
  if (!user.employeeNo) {
    return {
      groups: [],
      counts: {
        total: 0,
        notStarted: 0,
        inProgress: 0,
        returned: 0,
        submitted: 0,
      },
    };
  }
  const relations = await prisma.reviewRelation.findMany({
    where: {
      active: true,
      reviewer: { employeeNo: user.employeeNo },
      project: { deletedAt: null },
    },
    include: {
      reviewee: {
        select: {
          name: true,
          employeeNo: true,
          department: true,
          position: true,
        },
      },
      project: true,
      tasks: true,
    },
  });

  const items: MyTaskItem[] = [];
  const syncedProjects = new Map<string, Project>();
  for (const rel of relations) {
    const task = rel.tasks[0];
    if (!task) continue;
    let project = syncedProjects.get(rel.projectId) ?? rel.project;
    if (project === rel.project) {
      project = await syncStatus(project);
      syncedProjects.set(rel.projectId, project);
    }
    if (!VISIBLE_PROJECT_STATUSES.has(project.status)) continue;
    items.push({
      taskId: task.id,
      relationType: rel.relationType,
      status: task.status,
      submittedAt: task.submittedAt?.toISOString() ?? null,
      returnedAt: task.returnedAt?.toISOString() ?? null,
      reviewee: rel.reviewee,
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        endAt: project.endAt?.toISOString() ?? null,
      },
    });
  }
  items.sort((a, b) =>
    a.project.name === b.project.name
      ? a.reviewee.name.localeCompare(b.reviewee.name, "zh-Hans-CN")
      : a.project.name.localeCompare(b.project.name, "zh-Hans-CN"),
  );

  return {
    groups: RELATION_ORDER.map((relationType) => ({
      relationType,
      label: RELATION_LABELS[relationType],
      tasks: items.filter((t) => t.relationType === relationType),
    })),
    counts: {
      total: items.length,
      notStarted: items.filter((t) => t.status === "NOT_STARTED").length,
      inProgress: items.filter((t) => t.status === "IN_PROGRESS").length,
      returned: items.filter((t) => t.status === "RETURNED").length,
      submitted: items.filter((t) => t.status === "SUBMITTED").length,
    },
  };
}

// ---------- 任务详情（问卷结构按关系过滤） ----------

async function loadRawTree(questionnaireId: string): Promise<RawDimension[]> {
  const dims = await prisma.dimension.findMany({
    where: { questionnaireId, parentId: null },
    orderBy: { order: "asc" },
    include: {
      children: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" } } },
      },
      questions: { orderBy: { order: "asc" } },
    },
  });
  return dims.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    order: d.order,
    applicableSelf: d.applicableSelf,
    applicableManager: d.applicableManager,
    applicablePeer: d.applicablePeer,
    applicableSubordinate: d.applicableSubordinate,
    children: d.children.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      order: c.order,
      applicableSelf: c.applicableSelf,
      applicableManager: c.applicableManager,
      applicablePeer: c.applicablePeer,
      applicableSubordinate: c.applicableSubordinate,
      children: [],
      questions: c.questions.map((q) => ({
        id: q.id,
        code: q.code,
        type: q.type,
        title: q.title,
        description: q.description,
        required: q.required,
        order: q.order,
        overrideRelationRules: q.overrideRelationRules,
        applicableSelf: q.applicableSelf,
        applicableManager: q.applicableManager,
        applicablePeer: q.applicablePeer,
        applicableSubordinate: q.applicableSubordinate,
      })),
    })),
    questions: d.questions.map((q) => ({
      id: q.id,
      code: q.code,
      type: q.type,
      title: q.title,
      description: q.description,
      required: q.required,
      order: q.order,
      overrideRelationRules: q.overrideRelationRules,
      applicableSelf: q.applicableSelf,
      applicableManager: q.applicableManager,
      applicablePeer: q.applicablePeer,
      applicableSubordinate: q.applicableSubordinate,
    })),
  }));
}

type TaskBundle = {
  task: ReviewTask;
  relation: { revieweePersonId: string; relationType: RelationType };
  project: Project;
  questionnaire: Questionnaire;
  tree: TaskDimension[];
  questions: TaskQuestion[];
};

/** 加载任务 + 按关系过滤后的问卷结构（项目状态惰性同步） */
async function loadTaskBundle(taskId: string, user: User): Promise<TaskBundle> {
  const { task, relation, project } = await requireReviewerTask(taskId, user);
  const synced = await syncStatus(project);
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { projectId: project.id },
  });
  if (!questionnaire) {
    throw new ApiError(404, "项目问卷不存在");
  }
  const rawTree = await loadRawTree(questionnaire.id);
  const tree = filterTreeForRelation(rawTree, relation.relationType);
  return {
    task,
    relation: {
      revieweePersonId: relation.revieweePersonId,
      relationType: relation.relationType,
    },
    project: synced,
    questionnaire,
    tree,
    questions: flattenQuestions(tree),
  };
}

export type TaskDetailDTO = {
  task: {
    id: string;
    status: TaskStatus;
    submittedAt: string | null;
    returnedAt: string | null;
    currentSubmissionVersion: number | null;
    editable: boolean;
  };
  project: {
    id: string;
    name: string;
    status: string;
    endAt: string | null;
    instruction: string | null;
  };
  relationType: RelationType;
  reviewee: {
    name: string;
    employeeNo: string;
    department: string | null;
    position: string | null;
    grade: string | null;
  };
  scales: Array<{ value: number; label: string }>;
  dimensions: TaskDimension[];
};

/** 任务详情：被评人信息 + 该关系适用的问卷结构 + 项目自定义量表（技术文档第 42 节） */
export async function getTaskDetail(
  taskId: string,
  user: User,
): Promise<TaskDetailDTO> {
  const { task, relation, project, tree } = await loadTaskBundle(taskId, user);
  const [reviewee, scales] = await Promise.all([
    prisma.projectPerson.findUnique({
      where: { id: relation.revieweePersonId },
      select: {
        name: true,
        employeeNo: true,
        department: true,
        position: true,
        grade: true,
      },
    }),
    prisma.projectScale.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    }),
  ]);
  if (!reviewee) {
    throw new ApiError(404, "被评人不存在");
  }
  const editable = project.status === "ACTIVE" && task.status !== "SUBMITTED";
  return {
    task: {
      id: task.id,
      status: task.status,
      submittedAt: task.submittedAt?.toISOString() ?? null,
      returnedAt: task.returnedAt?.toISOString() ?? null,
      currentSubmissionVersion: task.currentSubmissionVersion,
      editable,
    },
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      endAt: project.endAt?.toISOString() ?? null,
      instruction: project.questionnaireInstruction,
    },
    relationType: relation.relationType,
    reviewee,
    scales: scales.map((s) => ({ value: s.value.toNumber(), label: s.label })),
    dimensions: tree,
  };
}

// ---------- 草稿读写 ----------

export type DraftAnswerDTO = {
  questionId: string;
  score: number | null;
  textValue: string | null;
  updatedAt: string;
};

/** 读取草稿（仅评价人本人，requireReviewerTask 守卫；HR 无此数据路径） */
export async function getDraft(
  taskId: string,
  user: User,
): Promise<DraftAnswerDTO[]> {
  await requireReviewerTask(taskId, user);
  const answers = await prisma.draftAnswer.findMany({
    where: { taskId },
    orderBy: { updatedAt: "asc" },
  });
  return answers.map((a) => ({
    questionId: a.questionId,
    score: a.score === null ? null : a.score.toNumber(),
    textValue: a.textValue,
    updatedAt: a.updatedAt.toISOString(),
  }));
}

/** 草稿写入窗口：项目 ACTIVE 且任务未提交（SUBMITTED 后必须先退回） */
function assertDraftWritable(task: ReviewTask, project: Project) {
  if (project.status !== "ACTIVE") {
    throw new ApiError(409, "项目当前不可填写评价（未开始或已截止）");
  }
  if (task.status === "SUBMITTED") {
    throw new ApiError(
      409,
      "已提交的评价不能修改，如需修改请联系项目管理员退回",
    );
  }
}

/**
 * 保存草稿（增量）：只写入本次提交的题目，其余草稿不动。
 * 首次写入将任务置为 IN_PROGRESS；RETURNED 状态保持不变（重交后才变 SUBMITTED）。
 */
export async function saveDraft(
  taskId: string,
  user: User,
  body: unknown,
): Promise<{ saved: number; status: TaskStatus }> {
  const { task, project, questions } = await loadTaskBundle(taskId, user);
  assertDraftWritable(task, project);

  const payload = (body ?? {}) as { answers?: unknown };
  const applicableById = new Map(questions.map((q) => [q.id, q]));
  let inputs;
  try {
    inputs = validateDraftAnswers(payload.answers, applicableById);
  } catch (err) {
    if (err instanceof DraftValidationError) {
      throw new ApiError(400, err.message);
    }
    throw err;
  }

  const status = await prisma.$transaction(async (tx: Tx) => {
    for (const input of inputs) {
      await tx.draftAnswer.upsert({
        where: { taskId_questionId: { taskId, questionId: input.questionId } },
        create: {
          taskId,
          questionId: input.questionId,
          score: input.score,
          textValue: input.textValue,
        },
        update: {
          score: input.score,
          textValue: input.textValue,
        },
      });
    }
    if (task.status === "NOT_STARTED") {
      const updated = await tx.reviewTask.update({
        where: { id: taskId },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
      });
      return updated.status;
    }
    return task.status;
  });
  return { saved: inputs.length, status };
}

// ---------- 提交（版本快照） ----------

export type SubmitResult = {
  taskId: string;
  version: number;
  status: "SUBMITTED";
};

export type MissingItem = { code: string; title: string };

type SubmitOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: string; missing?: MissingItem[] };

/**
 * 提交核心逻辑（单人 submitTask 与批量 batchSubmitTasks 共用）：
 * 权限错误（403/404）直接抛出；窗口/必答问题返回结构化失败原因。
 */
async function attemptSubmit(
  taskId: string,
  user: User,
): Promise<{ revieweeName: string; outcome: SubmitOutcome }> {
  const { task, relation, project, questionnaire, questions } =
    await loadTaskBundle(taskId, user);
  const reviewee = await prisma.projectPerson.findUnique({
    where: { id: relation.revieweePersonId },
    select: { name: true },
  });
  const revieweeName = reviewee?.name ?? "被评人";

  if (project.status !== "ACTIVE") {
    return {
      revieweeName,
      outcome: { ok: false, reason: "项目当前不可填写评价（未开始或已截止）" },
    };
  }
  if (task.status === "SUBMITTED") {
    return {
      revieweeName,
      outcome: { ok: false, reason: "已提交，无需重复提交" },
    };
  }

  const drafts = await prisma.draftAnswer.findMany({ where: { taskId } });
  const answerMap = new Map(
    drafts.map((d) => [
      d.questionId,
      {
        score: d.score === null ? null : d.score.toNumber(),
        textValue: d.textValue,
      },
    ]),
  );
  const missing = findMissingRequired(questions, answerMap);
  if (missing.length > 0) {
    return {
      revieweeName,
      outcome: {
        ok: false,
        reason: "必答项未完成，请填写后再提交",
        missing: missing.map((q) => ({ code: q.code, title: q.title })),
      },
    };
  }

  const version = (task.currentSubmissionVersion ?? 0) + 1;
  const now = new Date();
  const applicableIds = new Set(questions.map((q) => q.id));
  await prisma.$transaction(async (tx: Tx) => {
    await tx.submission.updateMany({
      where: { taskId, invalidatedAt: null },
      data: { invalidatedAt: now, invalidReason: "新版本覆盖" },
    });
    const submission = await tx.submission.create({
      data: { taskId, version },
    });
    const snapshots = drafts
      .filter((d) => applicableIds.has(d.questionId))
      .map((d) => ({
        submissionId: submission.id,
        questionId: d.questionId,
        score: d.score,
        textValue: d.textValue,
      }));
    if (snapshots.length > 0) {
      await tx.submissionAnswer.createMany({ data: snapshots });
    }
    await tx.reviewTask.update({
      where: { id: taskId },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        currentSubmissionVersion: version,
      },
    });
    if (!questionnaire.lockedAt) {
      await tx.questionnaire.update({
        where: { id: questionnaire.id },
        data: { lockedAt: now },
      });
    }
  });
  return { revieweeName, outcome: { ok: true, version } };
}

/**
 * 按人提交：必答项齐全 → 生成 Submission 新版本 + SubmissionAnswer 快照。
 * - 旧有效版本标记 invalidatedAt（新版本覆盖）
 * - 项目首次正式提交设置问卷 lockedAt（此后 HR 不能再改问卷）
 */
export async function submitTask(
  taskId: string,
  user: User,
): Promise<SubmitResult> {
  const { outcome } = await attemptSubmit(taskId, user);
  if (outcome.ok) {
    return { taskId, version: outcome.version, status: "SUBMITTED" };
  }
  throw new ApiError(outcome.missing ? 400 : 409, outcome.reason, {
    ...(outcome.missing ? { missing: outcome.missing } : {}),
  });
}

// ---------- 批量提交（矩阵模式） ----------

export type BatchSubmitResult = {
  submitted: Array<{
    taskId: string;
    revieweeName: string;
    version: number;
  }>;
  skipped: Array<{
    taskId: string;
    revieweeName: string;
    reason: string;
    missing?: MissingItem[];
  }>;
};

const MAX_BATCH_SUBMIT = 100;

/**
 * 批量提交（PRD 第 27 节）：一次提交所有已填写完整的人员，
 * 必答不全 / 已提交 / 窗口不允许的跳过并返回原因；权限错误（非本人任务）整体 403。
 */
export async function batchSubmitTasks(
  user: User,
  body: unknown,
): Promise<BatchSubmitResult> {
  const payload = (body ?? {}) as { taskIds?: unknown };
  if (!Array.isArray(payload.taskIds) || payload.taskIds.length === 0) {
    throw new ApiError(400, "taskIds 不能为空");
  }
  if (payload.taskIds.length > MAX_BATCH_SUBMIT) {
    throw new ApiError(400, `单次最多提交 ${MAX_BATCH_SUBMIT} 份`);
  }
  const seen = new Set<string>();
  for (const id of payload.taskIds) {
    if (typeof id !== "string" || !id) {
      throw new ApiError(400, "taskIds 格式错误");
    }
    seen.add(id);
  }

  const submitted: BatchSubmitResult["submitted"] = [];
  const skipped: BatchSubmitResult["skipped"] = [];
  for (const taskId of seen) {
    const { revieweeName, outcome } = await attemptSubmit(taskId, user);
    if (outcome.ok) {
      submitted.push({ taskId, revieweeName, version: outcome.version });
    } else {
      skipped.push({ taskId, revieweeName, reason: outcome.reason });
      if (outcome.missing) {
        skipped[skipped.length - 1]!.missing = outcome.missing;
      }
    }
  }
  return { submitted, skipped };
}

// ---------- 矩阵模式数据（技术文档第 50 节） ----------

export type MatrixTaskDTO = {
  taskId: string;
  status: TaskStatus;
  editable: boolean;
  reviewee: {
    name: string;
    employeeNo: string;
    department: string | null;
    position: string | null;
  };
  drafts: Array<{
    questionId: string;
    score: number | null;
    textValue: string | null;
  }>;
};

export type MatrixGroupDTO = {
  project: {
    id: string;
    name: string;
    status: string;
    endAt: string | null;
    instruction: string | null;
  };
  scales: Array<{ value: number; label: string }>;
  dimensions: TaskDimension[];
  tasks: MatrixTaskDTO[];
};

export type MyMatrixDTO = {
  relationType: RelationType;
  /** 各关系的可见任务数（渲染关系切换 tab） */
  relationCounts: Record<RelationType, number>;
  groups: MatrixGroupDTO[];
};

const VALID_RELATIONS = new Set<string>([
  "SELF",
  "MANAGER",
  "PEER",
  "SUBORDINATE",
]);

function emptyRelationCounts(): Record<RelationType, number> {
  return { SELF: 0, MANAGER: 0, PEER: 0, SUBORDINATE: 0 };
}

/**
 * 矩阵模式数据：某关系下（跨项目）的全部任务 + 按关系过滤的问卷结构 + 草稿。
 * 单元格与单人模式共用同一 DraftAnswer（taskId + questionId），实时互通。
 * relation 缺省时自动选第一个有任务的关系。
 */
export async function getMyMatrix(
  user: User,
  relation?: string,
): Promise<MyMatrixDTO> {
  if (relation !== undefined && !VALID_RELATIONS.has(relation)) {
    throw new ApiError(400, "relation 参数不合法");
  }
  if (!user.employeeNo) {
    return {
      relationType: (relation ?? "SELF") as RelationType,
      relationCounts: emptyRelationCounts(),
      groups: [],
    };
  }

  const relations = await prisma.reviewRelation.findMany({
    where: {
      active: true,
      reviewer: { employeeNo: user.employeeNo },
      project: { deletedAt: null },
    },
    include: {
      reviewee: {
        select: {
          name: true,
          employeeNo: true,
          department: true,
          position: true,
        },
      },
      project: true,
      tasks: true,
    },
  });

  // 惰性同步项目状态 + 统计各关系任务数
  const syncedProjects = new Map<string, Project>();
  const relationCounts = emptyRelationCounts();
  const visibleRels: typeof relations = [];
  for (const rel of relations) {
    const task = rel.tasks[0];
    if (!task) continue;
    let project = syncedProjects.get(rel.projectId) ?? rel.project;
    if (project === rel.project) {
      project = await syncStatus(project);
      syncedProjects.set(rel.projectId, project);
    }
    if (!VISIBLE_PROJECT_STATUSES.has(project.status)) continue;
    relationCounts[rel.relationType] += 1;
    visibleRels.push(rel);
  }

  const selected =
    relation !== undefined
      ? (relation as RelationType)
      : (RELATION_ORDER.find((r) => relationCounts[r] > 0) ?? "SELF");
  const scoped = visibleRels.filter((rel) => rel.relationType === selected);

  // 按项目分组组装
  const byProject = new Map<
    string,
    { project: Project; rels: typeof relations }
  >();
  for (const rel of scoped) {
    const project = syncedProjects.get(rel.projectId)!;
    const entry = byProject.get(rel.projectId) ?? { project, rels: [] };
    entry.rels.push(rel);
    byProject.set(rel.projectId, entry);
  }

  const taskIds = scoped.map((rel) => rel.tasks[0]!.id);
  const drafts = taskIds.length
    ? await prisma.draftAnswer.findMany({
        where: { taskId: { in: taskIds } },
        orderBy: { updatedAt: "asc" },
      })
    : [];
  const draftsByTask = new Map<string, typeof drafts>();
  for (const d of drafts) {
    const list = draftsByTask.get(d.taskId) ?? [];
    list.push(d);
    draftsByTask.set(d.taskId, list);
  }

  const groups: MatrixGroupDTO[] = [];
  for (const { project, rels } of byProject.values()) {
    const questionnaire = await prisma.questionnaire.findUnique({
      where: { projectId: project.id },
    });
    const tree = questionnaire
      ? filterTreeForRelation(await loadRawTree(questionnaire.id), selected)
      : [];
    const scales = await prisma.projectScale.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    });
    groups.push({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        endAt: project.endAt?.toISOString() ?? null,
        instruction: project.questionnaireInstruction,
      },
      scales: scales.map((s) => ({
        value: s.value.toNumber(),
        label: s.label,
      })),
      dimensions: tree,
      tasks: rels
        .map((rel) => {
          const task = rel.tasks[0]!;
          return {
            taskId: task.id,
            status: task.status,
            editable:
              project.status === "ACTIVE" && task.status !== "SUBMITTED",
            reviewee: rel.reviewee,
            drafts: (draftsByTask.get(task.id) ?? []).map((d) => ({
              questionId: d.questionId,
              score: d.score === null ? null : d.score.toNumber(),
              textValue: d.textValue,
            })),
          };
        })
        .sort((a, b) =>
          a.reviewee.name.localeCompare(b.reviewee.name, "zh-Hans-CN"),
        ),
    });
  }
  groups.sort((a, b) =>
    a.project.name.localeCompare(b.project.name, "zh-Hans-CN"),
  );

  return { relationType: selected, relationCounts, groups };
}

// ---------- HR 退回 ----------

/** 退回窗口：项目未冻结/归档（ACTIVE/CLOSED 均可，CLOSED 需 HR 重新开放后员工才能重交） */
const RETURNABLE_PROJECT_STATUSES = new Set(["ACTIVE", "CLOSED"]);

/**
 * HR 退回已提交的评价：任务 → RETURNED + 当前有效 Submission 失效 + 审计。
 * 评价人可重新编辑再提交（生成新版本，历史版本保留）。
 */
export async function returnTask(
  taskId: string,
  user: User,
): Promise<{ taskId: string; status: "RETURNED" }> {
  const task = await prisma.reviewTask.findUnique({
    where: { id: taskId },
    include: {
      relation: {
        include: {
          reviewee: { select: { employeeNo: true, name: true } },
          reviewer: { select: { employeeNo: true, name: true } },
        },
      },
    },
  });
  if (!task) {
    throw new ApiError(404, "评价任务不存在");
  }
  const project = await syncStatus(
    await requireProjectAdmin(task.projectId, user),
  );
  if (!RETURNABLE_PROJECT_STATUSES.has(project.status)) {
    throw new ApiError(409, "项目已冻结或归档，不能退回评价");
  }
  if (task.status !== "SUBMITTED") {
    throw new ApiError(409, "只有已提交的评价才能退回");
  }

  const now = new Date();
  await prisma.$transaction(async (tx: Tx) => {
    await tx.reviewTask.update({
      where: { id: taskId },
      data: { status: "RETURNED", returnedAt: now },
    });
    await tx.submission.updateMany({
      where: { taskId, invalidatedAt: null },
      data: { invalidatedAt: now, invalidReason: "HR退回" },
    });
    await writeAudit(
      {
        actorUserId: user.id,
        projectId: task.projectId,
        action: "RETURN_REVIEW",
        entityType: "ReviewTask",
        entityId: taskId,
        metadata: {
          version: task.currentSubmissionVersion,
          relationType: task.relation.relationType,
          reviewee: `${task.relation.reviewee.name}（${task.relation.reviewee.employeeNo}）`,
          reviewer: `${task.relation.reviewer.name}（${task.relation.reviewer.employeeNo}）`,
        },
      },
      tx,
    );
  });
  return { taskId, status: "RETURNED" };
}
