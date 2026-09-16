import type {
  ProjectPerson,
  ReviewRelation,
  User,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, requireProjectAdmin } from "@/lib/permissions";
import { writeAudit } from "@/modules/audit/service";
import { syncStatus } from "@/modules/projects/service";
import { parseRelationsExcel } from "./excel";
import {
  checkRelations,
  parseRelationType,
  type ImportedRelationType,
  type PersonInput,
  type RelationsCheckResult,
} from "./validate";

/**
 * 评价关系服务（PRD 第 16~20 节 / 技术文档第 41、48 节）。
 *
 * - Excel 导入严格 Preview / Commit 两阶段；Commit 在数据库事务内，失败整批回滚
 * - Commit 为整体替换：Excel 是全量关系真相（自评 SELF 除外，由系统管理）
 * - 手工调整（新增/修改/删除）即使已有提交也允许（PRD 第 20 节）；
 *   删除已提交的关系 → active=false 软删除，该评价不再参与结果
 * - FROZEN / ARCHIVED 项目禁止任何关系调整
 */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const EDITABLE_STATUSES = new Set(["DRAFT", "PUBLISHED", "ACTIVE", "CLOSED"]);

/** 关系调整窗口：FROZEN / ARCHIVED 禁止（其余状态均可，PRD 第 20 节） */
async function requireRelationEditable(projectId: string, user: User) {
  const project = await syncStatus(await requireProjectAdmin(projectId, user));
  if (!EDITABLE_STATUSES.has(project.status)) {
    throw new ApiError(409, "项目已冻结或归档，不能调整评价关系");
  }
  return project;
}

function pairKeyOf(revieweePersonId: string, reviewerPersonId: string) {
  return `${revieweePersonId}|${reviewerPersonId}`;
}

function hasSubmitted(rel: { tasks: { status: string }[] }): boolean {
  return rel.tasks.some(
    (t) => t.status === "SUBMITTED" || t.status === "RETURNED",
  );
}

// ---------- Preview ----------

/** 预检查：解析 → 校验，不写任何正式表（PRD 第 18 节） */
export async function previewRelationsImport(
  projectId: string,
  user: User,
  buffer: Buffer,
): Promise<RelationsCheckResult> {
  await requireProjectAdmin(projectId, user);
  const rows = await parseRelationsExcel(buffer);
  return checkRelations(rows);
}

// ---------- Commit ----------

export type CommitResult = {
  peopleCreated: number;
  peopleUpdated: number;
  relationsCreated: number;
  relationsUpdated: number;
  relationsDeactivated: number;
  relationsDeleted: number;
  selfRelationsCreated: number;
};

/**
 * 正式导入：整体替换非 SELF 关系（Excel = 全量真相），事务内失败整批回滚。
 * 人员 upsert（快照，铁律 6）；新被评人自动生成自评关系 + 任务。
 */
export async function commitRelationsImport(
  projectId: string,
  user: User,
  buffer: Buffer,
): Promise<CommitResult> {
  await requireRelationEditable(projectId, user);
  const rows = await parseRelationsExcel(buffer);
  const check = checkRelations(rows);
  if (check.errors > 0 || check.conflicts > 0) {
    throw new ApiError(400, "存在错误或冲突行，请修正后重新上传", {
      issues: check.issues.filter(
        (i) => i.type === "error" || i.type === "conflict",
      ),
    });
  }

  return prisma.$transaction(async (tx) => {
    const result = await replaceRelations(tx, projectId, check);
    const self = await syncSelfRelations(tx, projectId);
    return { ...result, selfRelationsCreated: self.created };
  });
}

/** 事务核心：人员 upsert + 非 SELF 关系整体替换 */
async function replaceRelations(
  tx: Tx,
  projectId: string,
  check: RelationsCheckResult,
): Promise<Omit<CommitResult, "selfRelationsCreated">> {
  // 1. 人员 upsert（不删除 Excel 外人员：手工新增的人员与历史快照保留）
  const existingPeople = await tx.projectPerson.findMany({
    where: { projectId },
  });
  const peopleByNo = new Map(existingPeople.map((p) => [p.employeeNo, p]));
  const toCreate: PersonInput[] = [];
  const toUpdate: { existing: ProjectPerson; incoming: PersonInput }[] = [];
  for (const person of check.people) {
    const existing = peopleByNo.get(person.employeeNo);
    if (!existing) {
      toCreate.push(person);
    } else if (
      existing.name !== person.name ||
      (person.department !== null &&
        existing.department !== person.department) ||
      (person.position !== null && existing.position !== person.position) ||
      (person.grade !== null && existing.grade !== person.grade)
    ) {
      toUpdate.push({ existing, incoming: person });
    }
  }
  if (toCreate.length > 0) {
    await tx.projectPerson.createMany({
      data: toCreate.map((p) => ({ projectId, ...p })),
    });
  }
  for (const { existing, incoming } of toUpdate) {
    await tx.projectPerson.update({
      where: { id: existing.id },
      data: {
        name: incoming.name,
        // Excel 中非空才覆盖（评价人行信息为空，保留被评人行的完整信息）
        department: incoming.department ?? existing.department,
        position: incoming.position ?? existing.position,
        grade: incoming.grade ?? existing.grade,
      },
    });
  }
  // 工号 → personId 映射（含新建）
  const allPeople = existingPeople.concat(
    toCreate.length > 0
      ? await tx.projectPerson.findMany({
          where: {
            projectId,
            employeeNo: { in: toCreate.map((p) => p.employeeNo) },
          },
        })
      : [],
  );
  const idByNo = new Map(allPeople.map((p) => [p.employeeNo, p.id]));

  // 2. 非 SELF 关系整体替换
  const existingRelations = await tx.reviewRelation.findMany({
    where: { projectId, relationType: { not: "SELF" } },
    include: { tasks: { select: { status: true } } },
  });
  const relationByPair = new Map(
    existingRelations.map((r) => [
      pairKeyOf(r.revieweePersonId, r.reviewerPersonId),
      r,
    ]),
  );
  const excelPairs = new Map(
    check.relations.map((r) => {
      const revieweeId = idByNo.get(r.revieweeEmployeeNo)!;
      const reviewerId = idByNo.get(r.reviewerEmployeeNo)!;
      return [pairKeyOf(revieweeId, reviewerId), { r, revieweeId, reviewerId }];
    }),
  );

  let relationsCreated = 0;
  let relationsUpdated = 0;
  let relationsDeactivated = 0;
  let relationsDeleted = 0;
  const keptRelationIds: string[] = [];

  for (const rel of existingRelations) {
    const key = pairKeyOf(rel.revieweePersonId, rel.reviewerPersonId);
    const incoming = excelPairs.get(key);
    if (!incoming) {
      // 不在 Excel：active 的删除（已提交软删，否则物理删）
      if (rel.active) {
        if (hasSubmitted(rel)) {
          await tx.reviewRelation.update({
            where: { id: rel.id },
            data: { active: false },
          });
          relationsDeactivated += 1;
        } else {
          await tx.reviewRelation.delete({ where: { id: rel.id } });
          relationsDeleted += 1;
        }
      }
      continue;
    }
    // 在 Excel：保留行并对齐类型（PRD 20：已有提交也可调整）
    keptRelationIds.push(rel.id);
    if (rel.relationType !== incoming.r.relationType || !rel.active) {
      await tx.reviewRelation.update({
        where: { id: rel.id },
        data: {
          relationType: incoming.r.relationType,
          active: true,
        },
      });
      relationsUpdated += 1;
    }
  }

  // 全新关系批量创建（含任务）
  const newPairs = Array.from(excelPairs.values()).filter(
    ({ revieweeId, reviewerId }) =>
      !relationByPair.has(pairKeyOf(revieweeId, reviewerId)),
  );
  if (newPairs.length > 0) {
    const created = await tx.reviewRelation.createManyAndReturn({
      data: newPairs.map(({ r, revieweeId, reviewerId }) => ({
        projectId,
        revieweePersonId: revieweeId,
        reviewerPersonId: reviewerId,
        relationType: r.relationType,
      })),
    });
    relationsCreated = created.length;
    await tx.reviewTask.createMany({
      data: created.map((rel) => ({
        projectId,
        relationId: rel.id,
      })),
    });
    keptRelationIds.push(...created.map((rel) => rel.id));
  }

  // 保留的关系补齐缺失任务（正常创建时同步生成，防御性兜底）
  if (keptRelationIds.length > 0) {
    const taskRelationIds = new Set(
      (
        await tx.reviewTask.findMany({
          where: { relationId: { in: keptRelationIds } },
          select: { relationId: true },
        })
      ).map((t) => t.relationId),
    );
    const missing = keptRelationIds.filter((id) => !taskRelationIds.has(id));
    if (missing.length > 0) {
      await tx.reviewTask.createMany({
        data: missing.map((relationId) => ({ projectId, relationId })),
      });
    }
  }

  return {
    peopleCreated: toCreate.length,
    peopleUpdated: toUpdate.length,
    relationsCreated,
    relationsUpdated,
    relationsDeactivated,
    relationsDeleted,
  };
}

// ---------- 自评同步 ----------

/**
 * 自评关系同步（PRD 16.1：项目启用自评后系统自动生成 SELF 关系 + 任务）。
 * - enabled=true：为所有"有 active 非 SELF 被评关系但无 SELF 关系"的人生成
 *   （曾被 HR 手工删除的 inactive SELF 不自动恢复，尊重删除动作）
 * - enabled=false：删除全部 SELF（已提交软删，否则物理删）
 * - reviewee 不再被评（无 active 非 SELF 关系）：其 active SELF 同步删除
 */
export async function syncSelfRelations(
  tx: Tx,
  projectId: string,
): Promise<{ created: number }> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { selfReviewEnabled: true },
  });
  if (!project) throw new ApiError(404, "项目不存在");

  const selfRelations = await tx.reviewRelation.findMany({
    where: { projectId, relationType: "SELF" },
    include: { tasks: { select: { status: true } } },
  });
  const selfByReviewee = new Map(
    selfRelations.map((r) => [r.revieweePersonId, r]),
  );

  if (!project.selfReviewEnabled) {
    let deactivated = 0;
    for (const rel of selfRelations) {
      if (!rel.active) continue;
      if (hasSubmitted(rel)) {
        await tx.reviewRelation.update({
          where: { id: rel.id },
          data: { active: false },
        });
        deactivated += 1;
      } else {
        await tx.reviewRelation.delete({ where: { id: rel.id } });
      }
    }
    void deactivated;
    return { created: 0 };
  }

  // 目标被评人集合：有 active 非 SELF 关系的 reviewee
  const activeRelations = await tx.reviewRelation.findMany({
    where: { projectId, active: true, relationType: { not: "SELF" } },
    select: { revieweePersonId: true },
  });
  const revieweeIds = new Set(activeRelations.map((r) => r.revieweePersonId));

  // 1) 不再被评的人：删除其 active SELF
  for (const rel of selfRelations) {
    if (rel.active && !revieweeIds.has(rel.revieweePersonId)) {
      if (hasSubmitted(rel)) {
        await tx.reviewRelation.update({
          where: { id: rel.id },
          data: { active: false },
        });
      } else {
        await tx.reviewRelation.delete({ where: { id: rel.id } });
      }
    }
  }

  // 2) 缺 SELF 的被评人：批量生成关系 + 任务
  const missing = Array.from(revieweeIds).filter(
    (id) => !selfByReviewee.has(id),
  );
  if (missing.length === 0) return { created: 0 };
  const created = await tx.reviewRelation.createManyAndReturn({
    data: missing.map((personId) => ({
      projectId,
      revieweePersonId: personId,
      reviewerPersonId: personId,
      relationType: "SELF" as const,
    })),
  });
  await tx.reviewTask.createMany({
    data: created.map((rel) => ({ projectId, relationId: rel.id })),
  });
  return { created: created.length };
}

// ---------- 查询 ----------

export type RelationDTO = {
  id: string;
  relationType: "SELF" | "MANAGER" | "PEER" | "SUBORDINATE";
  active: boolean;
  reviewee: { employeeNo: string; name: string; department: string | null };
  reviewer: { employeeNo: string; name: string; department: string | null };
  taskStatus: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED" | null;
  createdAt: string;
};

/** 关系列表（含双方人员信息与任务状态，供 TanStack Table） */
export async function listRelations(
  projectId: string,
  user: User,
): Promise<RelationDTO[]> {
  await requireProjectAdmin(projectId, user);
  const relations = await prisma.reviewRelation.findMany({
    where: { projectId },
    include: {
      reviewee: {
        select: { employeeNo: true, name: true, department: true },
      },
      reviewer: {
        select: { employeeNo: true, name: true, department: true },
      },
      tasks: { select: { status: true } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return relations.map((r) => ({
    id: r.id,
    relationType: r.relationType,
    active: r.active,
    reviewee: r.reviewee,
    reviewer: r.reviewer,
    taskStatus: r.tasks[0]?.status ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type PersonDTO = {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  grade: string | null;
  revieweeCount: number;
  reviewerCount: number;
  hasSelfRelation: boolean;
};

/** 人员列表（含被评/评价次数统计） */
export async function listPeople(
  projectId: string,
  user: User,
): Promise<PersonDTO[]> {
  await requireProjectAdmin(projectId, user);
  const people = await prisma.projectPerson.findMany({
    where: { projectId },
    include: {
      revieweeRelations: {
        where: { active: true },
        select: { relationType: true },
      },
      reviewerRelations: {
        where: { active: true },
        select: { relationType: true },
      },
    },
    orderBy: { employeeNo: "asc" },
  });
  return people.map((p) => ({
    id: p.id,
    employeeNo: p.employeeNo,
    name: p.name,
    department: p.department,
    position: p.position,
    grade: p.grade,
    revieweeCount: p.revieweeRelations.filter((r) => r.relationType !== "SELF")
      .length,
    reviewerCount: p.reviewerRelations.filter((r) => r.relationType !== "SELF")
      .length,
    hasSelfRelation: p.revieweeRelations.some((r) => r.relationType === "SELF"),
  }));
}

// ---------- 手工调整（PRD 第 20 节：已有提交仍可调整） ----------

export type CreateRelationInput = {
  revieweeEmployeeNo: string;
  revieweeName?: string;
  revieweeDepartment?: string;
  revieweePosition?: string;
  revieweeGrade?: string;
  reviewerEmployeeNo: string;
  reviewerName: string;
  relationType: string;
};

async function upsertPersonByNo(
  tx: Tx,
  projectId: string,
  employeeNo: string,
  name: string,
  extra?: { department?: string; position?: string; grade?: string },
): Promise<ProjectPerson> {
  const existing = await tx.projectPerson.findUnique({
    where: { projectId_employeeNo: { projectId, employeeNo } },
  });
  if (existing) {
    // 姓名/信息更新为 HR 手工输入的最新值（只补空不覆盖）
    return tx.projectPerson.update({
      where: { id: existing.id },
      data: {
        name,
        department: existing.department ?? extra?.department ?? null,
        position: existing.position ?? extra?.position ?? null,
        grade: existing.grade ?? extra?.grade ?? null,
      },
    });
  }
  return tx.projectPerson.create({
    data: {
      projectId,
      employeeNo,
      name,
      department: extra?.department ?? null,
      position: extra?.position ?? null,
      grade: extra?.grade ?? null,
    },
  });
}

/** 手工新增关系：人员不存在则创建；同 pair 已有 active 关系 → 409；新被评人补自评 */
export async function createRelation(
  projectId: string,
  user: User,
  input: CreateRelationInput,
): Promise<RelationDTO> {
  const project = await requireRelationEditable(projectId, user);
  const employeeNoRe = /^\S+$/;
  if (
    !input.revieweeEmployeeNo.trim() ||
    !input.reviewerEmployeeNo.trim() ||
    !input.reviewerName.trim()
  ) {
    throw new ApiError(400, "工号与姓名不能为空");
  }
  if (
    !employeeNoRe.test(input.revieweeEmployeeNo) ||
    !employeeNoRe.test(input.reviewerEmployeeNo)
  ) {
    throw new ApiError(400, "工号不能包含空格");
  }
  const relationType = parseRelationType(input.relationType ?? "");
  if (!relationType) {
    throw new ApiError(400, "关系类型必须为：上级 / 平级 / 下级");
  }

  const relationId = await prisma.$transaction(async (tx) => {
    const reviewee = await upsertPersonByNo(
      tx,
      projectId,
      input.revieweeEmployeeNo.trim(),
      input.revieweeName?.trim() || input.revieweeEmployeeNo.trim(),
      {
        department: input.revieweeDepartment,
        position: input.revieweePosition,
        grade: input.revieweeGrade,
      },
    );
    const reviewer = await upsertPersonByNo(
      tx,
      projectId,
      input.reviewerEmployeeNo.trim(),
      input.reviewerName.trim(),
    );

    const existing = await tx.reviewRelation.findUnique({
      where: {
        projectId_revieweePersonId_reviewerPersonId: {
          projectId,
          revieweePersonId: reviewee.id,
          reviewerPersonId: reviewer.id,
        },
      },
    });
    if (existing?.active) {
      throw new ApiError(409, "该评价人对该被评人已存在关系，请直接修改");
    }

    let relation: ReviewRelation;
    if (existing) {
      // 曾被删除（软删）：复用行并恢复（提交历史保留）
      relation = await tx.reviewRelation.update({
        where: { id: existing.id },
        data: { relationType, active: true },
      });
    } else {
      relation = await tx.reviewRelation.create({
        data: {
          projectId,
          revieweePersonId: reviewee.id,
          reviewerPersonId: reviewer.id,
          relationType,
        },
      });
      await tx.reviewTask.create({
        data: { projectId, relationId: relation.id },
      });
    }
    // 新被评人补自评
    await syncSelfRelations(tx, projectId);
    return relation.id;
  });
  void project;
  return getRelationDTO(relationId);
}

/** 修改关系类型（写 CHANGE_RELATION 审计；SELF 不允许改） */
export async function updateRelation(
  relationId: string,
  user: User,
  relationTypeInput: unknown,
): Promise<RelationDTO> {
  const relation = await prisma.reviewRelation.findUnique({
    where: { id: relationId },
    include: {
      reviewee: { select: { employeeNo: true, name: true } },
      reviewer: { select: { employeeNo: true, name: true } },
      project: { select: { id: true } },
    },
  });
  if (!relation || relation.project === null) {
    throw new ApiError(404, "评价关系不存在");
  }
  await requireRelationEditable(relation.project.id, user);

  if (relation.relationType === "SELF") {
    throw new ApiError(400, "自评关系类型固定，不能修改");
  }
  const relationType = parseRelationType(
    typeof relationTypeInput === "string" ? relationTypeInput : "",
  );
  if (!relationType) {
    throw new ApiError(400, "关系类型必须为：上级 / 平级 / 下级");
  }
  if (relationType === relation.relationType && relation.active) {
    return getRelationDTO(relationId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.reviewRelation.update({
      where: { id: relationId },
      data: { relationType, active: true },
    });
    await writeAudit(
      {
        actorUserId: user.id,
        projectId: relation.project!.id,
        action: "CHANGE_RELATION",
        entityType: "ReviewRelation",
        entityId: relationId,
        metadata: {
          from: relation.relationType,
          to: relationType,
          reviewee: `${relation.reviewee.name}（${relation.reviewee.employeeNo}）`,
          reviewer: `${relation.reviewer.name}（${relation.reviewer.employeeNo}）`,
        },
      },
      tx,
    );
  });
  return getRelationDTO(relationId);
}

/**
 * 删除关系（写 DELETE_RELATION 审计）：
 * 无提交 → 物理删除；已提交 → active=false（该评价不再参与结果，历史保留）
 */
export async function deleteRelation(
  relationId: string,
  user: User,
): Promise<{ id: string; deactivated: boolean }> {
  const relation = await prisma.reviewRelation.findUnique({
    where: { id: relationId },
    include: {
      reviewee: { select: { employeeNo: true, name: true } },
      reviewer: { select: { employeeNo: true, name: true } },
      tasks: { select: { status: true } },
      project: { select: { id: true } },
    },
  });
  if (!relation || relation.project === null) {
    throw new ApiError(404, "评价关系不存在");
  }
  await requireRelationEditable(relation.project.id, user);

  const submitted = hasSubmitted(relation);
  await prisma.$transaction(async (tx) => {
    if (submitted) {
      await tx.reviewRelation.update({
        where: { id: relationId },
        data: { active: false },
      });
    } else {
      await tx.reviewRelation.delete({ where: { id: relationId } });
    }
    await writeAudit(
      {
        actorUserId: user.id,
        projectId: relation.project!.id,
        action: "DELETE_RELATION",
        entityType: "ReviewRelation",
        entityId: relationId,
        metadata: {
          deactivated: submitted,
          relationType: relation.relationType,
          reviewee: `${relation.reviewee.name}（${relation.reviewee.employeeNo}）`,
          reviewer: `${relation.reviewer.name}（${relation.reviewer.employeeNo}）`,
        },
      },
      tx,
    );
  });
  return { id: relationId, deactivated: submitted };
}

async function getRelationDTO(relationId: string): Promise<RelationDTO> {
  const relation = await prisma.reviewRelation.findUniqueOrThrow({
    where: { id: relationId },
    include: {
      reviewee: { select: { employeeNo: true, name: true, department: true } },
      reviewer: { select: { employeeNo: true, name: true, department: true } },
      tasks: { select: { status: true } },
    },
  });
  return {
    id: relation.id,
    relationType: relation.relationType,
    active: relation.active,
    reviewee: relation.reviewee,
    reviewer: relation.reviewer,
    taskStatus: relation.tasks[0]?.status ?? null,
    createdAt: relation.createdAt.toISOString(),
  };
}

export type { ImportedRelationType };
