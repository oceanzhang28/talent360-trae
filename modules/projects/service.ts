import type {
  Project,
  ProjectScale,
  User,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  ApiError,
  requireProjectAdmin,
  requireSystemAdmin,
} from "@/lib/permissions";

/**
 * 项目管理服务（PRD 第 6 节 / 技术文档第 16、39 节）。
 *
 * 状态机：DRAFT → PUBLISHED → ACTIVE → CLOSED → FROZEN → ARCHIVED（+ DELETED 软删除）
 * - PUBLISHED→ACTIVE、ACTIVE→CLOSED 由时间触发的惰性转换完成（读取时同步，syncStatus）
 * - publish / close / freeze / archive 由 HR（项目管理员）操作
 * - unfreeze / DELETE 仅系统管理员（PRD 6.3 / 第 5 节）
 *
 * 时间操作（PRD 6.3）：提前结束（close）、延长截止（ACTIVE 下 PATCH endAt）、
 * 重新开放（CLOSED 下 PATCH endAt 为未来时间 → 回到 ACTIVE）。
 */

export type ProjectDTO = {
  id: string;
  name: string;
  description: string | null;
  questionnaireInstruction: string | null;
  startAt: string | null;
  endAt: string | null;
  status: Project["status"];
  selfReviewEnabled: boolean;
  managerWeight: number;
  peerWeight: number;
  subordinateWeight: number;
  frozenAt: string | null;
  purgeAfter: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAdminDTO = {
  id: string;
  userId: string;
  employeeNo: string | null;
  name: string;
  createdAt: string;
};

export type ProjectScaleDTO = {
  id: string;
  value: number;
  label: string;
  order: number;
};

/** PRD 第 10 节：固定 10 档默认文字说明，创建项目时播种 */
const DEFAULT_SCALES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.5, label: "几乎没有体现" },
  { value: 1.0, label: "极少体现" },
  { value: 1.5, label: "较少体现" },
  { value: 2.0, label: "偶尔体现" },
  { value: 2.5, label: "部分体现" },
  { value: 3.0, label: "基本达到" },
  { value: 3.5, label: "较好体现" },
  { value: 4.0, label: "经常体现" },
  { value: 4.5, label: "表现突出" },
  { value: 5.0, label: "持续稳定体现" },
];

export type CreateProjectInput = {
  name?: unknown;
  description?: unknown;
  questionnaireInstruction?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  selfReviewEnabled?: unknown;
  managerWeight?: unknown;
  peerWeight?: unknown;
  subordinateWeight?: unknown;
};

export type UpdateProjectInput = CreateProjectInput;

/** undefined = 未提供（保持原值）；null = 显式清空 */
function parseDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, `${field} 不是合法的时间格式`);
  }
  return new Date(value);
}

function parseWeight(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new ApiError(400, `${field} 必须是 0~100 之间的数字`);
  }
  return n;
}

/** 权重合计校验（PRD 第 33 节）：以“百分之一”为单位取整求和，避免浮点误差 */
export function weightsSumTo100(
  manager: number,
  peer: number,
  subordinate: number,
): boolean {
  return (
    Math.round(manager * 100) +
      Math.round(peer * 100) +
      Math.round(subordinate * 100) ===
    10000
  );
}

/** 惰性状态同步：PUBLISHED 过开始时间 → ACTIVE；ACTIVE 过截止 → CLOSED */
async function syncStatus<T extends Project>(project: T): Promise<T> {
  const now = Date.now();
  let next: Project["status"] | null = null;
  if (
    project.status === "PUBLISHED" &&
    project.startAt &&
    project.startAt.getTime() <= now
  ) {
    next = "ACTIVE";
  } else if (
    project.status === "ACTIVE" &&
    project.endAt &&
    project.endAt.getTime() <= now
  ) {
    next = "CLOSED";
  }
  if (!next) return project;
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { status: next },
  });
  return { ...project, ...updated } as T;
}

export function serializeProject(project: Project): ProjectDTO {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    questionnaireInstruction: project.questionnaireInstruction,
    startAt: project.startAt?.toISOString() ?? null,
    endAt: project.endAt?.toISOString() ?? null,
    status: project.status,
    selfReviewEnabled: project.selfReviewEnabled,
    managerWeight: project.managerWeight.toNumber(),
    peerWeight: project.peerWeight.toNumber(),
    subordinateWeight: project.subordinateWeight.toNumber(),
    frozenAt: project.frozenAt?.toISOString() ?? null,
    purgeAfter: project.purgeAfter?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

/** 项目列表：系统管理员看所有；HR 只看自己管理的项目（不含软删除） */
export async function listProjects(user: User): Promise<ProjectDTO[]> {
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      ...(user.systemRole === "SYSTEM_ADMIN"
        ? {}
        : { admins: { some: { userId: user.id } } }),
    },
    orderBy: { createdAt: "desc" },
  });
  const synced = await Promise.all(projects.map((p) => syncStatus(p)));
  return synced.map(serializeProject);
}

export async function getProject(
  projectId: string,
  user: User,
): Promise<{
  project: ProjectDTO;
  admins: ProjectAdminDTO[];
  scales: ProjectScaleDTO[];
}> {
  await requireProjectAdmin(projectId, user);
  const found = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      admins: { include: { user: true }, orderBy: { createdAt: "asc" } },
      scales: { orderBy: { order: "asc" } },
    },
  });
  if (!found || found.deletedAt) throw new ApiError(404, "项目不存在");
  const synced = await syncStatus(found);
  return {
    project: serializeProject(synced),
    admins: synced.admins.map((a) => ({
      id: a.id,
      userId: a.userId,
      employeeNo: a.user.employeeNo,
      name: a.user.name,
      createdAt: a.createdAt.toISOString(),
    })),
    scales: synced.scales.map(serializeScale),
  };
}

function serializeScale(s: ProjectScale): ProjectScaleDTO {
  return {
    id: s.id,
    value: s.value.toNumber(),
    label: s.label,
    order: s.order,
  };
}

/** 创建项目：任何登录用户可创建（单公司内部工具），创建者自动成为项目管理员 */
export async function createProject(
  user: User,
  input: CreateProjectInput,
): Promise<ProjectDTO> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new ApiError(400, "项目名称不能为空");
  if (name.length > 100) throw new ApiError(400, "项目名称不能超过 100 字");

  const description =
    typeof input.description === "string" && input.description.trim() !== ""
      ? input.description.trim()
      : null;
  const questionnaireInstruction =
    typeof input.questionnaireInstruction === "string" &&
    input.questionnaireInstruction.trim() !== ""
      ? input.questionnaireInstruction.trim()
      : null;
  const startAt = parseDate(input.startAt, "开始时间");
  const endAt = parseDate(input.endAt, "截止时间");
  if (startAt && endAt && startAt.getTime() >= endAt.getTime()) {
    throw new ApiError(400, "开始时间必须早于截止时间");
  }

  const managerWeight = parseWeight(input.managerWeight ?? 40, "上级权重");
  const peerWeight = parseWeight(input.peerWeight ?? 30, "平级权重");
  const subordinateWeight = parseWeight(
    input.subordinateWeight ?? 30,
    "下级权重",
  );
  const selfReviewEnabled = input.selfReviewEnabled !== false;

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name,
        description,
        questionnaireInstruction,
        startAt,
        endAt,
        selfReviewEnabled,
        managerWeight,
        peerWeight,
        subordinateWeight,
        scales: {
          create: DEFAULT_SCALES.map((s, i) => ({
            value: s.value,
            label: s.label,
            order: i,
          })),
        },
        admins: { create: { userId: user.id } },
      },
    });
    return created;
  });
  return serializeProject(project);
}

/**
 * 更新项目：按状态限制可编辑字段（技术文档第 39 节）。
 * - DRAFT/PUBLISHED：全部字段
 * - ACTIVE：仅 endAt（只能延长，须晚于原截止时间）
 * - CLOSED：仅 endAt（重新开放：设为未来时间则回到 ACTIVE）
 * - FROZEN/ARCHIVED：不可编辑
 */
export async function updateProject(
  projectId: string,
  user: User,
  input: UpdateProjectInput,
): Promise<ProjectDTO> {
  const project = await requireProjectAdmin(projectId, user);
  const synced = await syncStatus(project);

  if (synced.status === "FROZEN" || synced.status === "ARCHIVED") {
    throw new ApiError(409, "已冻结/已归档的项目不能修改");
  }

  if (synced.status === "DRAFT" || synced.status === "PUBLISHED") {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) throw new ApiError(400, "项目名称不能为空");
      if (name.length > 100) throw new ApiError(400, "项目名称不能超过 100 字");
      data.name = name;
    }
    if (input.description !== undefined) {
      data.description =
        typeof input.description === "string" && input.description.trim() !== ""
          ? input.description.trim()
          : null;
    }
    if (input.questionnaireInstruction !== undefined) {
      data.questionnaireInstruction =
        typeof input.questionnaireInstruction === "string" &&
        input.questionnaireInstruction.trim() !== ""
          ? input.questionnaireInstruction.trim()
          : null;
    }
    const startAt = parseDate(input.startAt, "开始时间");
    const endAt = parseDate(input.endAt, "截止时间");
    if (startAt !== undefined) data.startAt = startAt;
    if (endAt !== undefined) data.endAt = endAt;
    const newStart =
      (data.startAt as Date | null | undefined) ?? synced.startAt;
    const newEnd = (data.endAt as Date | null | undefined) ?? synced.endAt;
    if (newStart && newEnd && newStart.getTime() >= newEnd.getTime()) {
      throw new ApiError(400, "开始时间必须早于截止时间");
    }
    if (input.selfReviewEnabled !== undefined) {
      data.selfReviewEnabled = input.selfReviewEnabled !== false;
    }
    if (
      input.managerWeight !== undefined ||
      input.peerWeight !== undefined ||
      input.subordinateWeight !== undefined
    ) {
      const managerWeight = parseWeight(
        input.managerWeight ?? synced.managerWeight.toNumber(),
        "上级权重",
      );
      const peerWeight = parseWeight(
        input.peerWeight ?? synced.peerWeight.toNumber(),
        "平级权重",
      );
      const subordinateWeight = parseWeight(
        input.subordinateWeight ?? synced.subordinateWeight.toNumber(),
        "下级权重",
      );
      data.managerWeight = managerWeight;
      data.peerWeight = peerWeight;
      data.subordinateWeight = subordinateWeight;
    }
    const updated = await prisma.project.update({
      where: { id: projectId },
      data,
    });
    return serializeProject(updated);
  }

  // ACTIVE / CLOSED：仅允许改 endAt
  const hasOtherFields = Object.keys(input).some((k) => k !== "endAt");
  if (hasOtherFields) {
    throw new ApiError(
      409,
      synced.status === "ACTIVE"
        ? "测评中的项目只能延长截止时间"
        : "已截止的项目只能重新设置截止时间",
    );
  }
  const endAt = parseDate(input.endAt, "截止时间");
  if (endAt === undefined || endAt === null) {
    throw new ApiError(400, "缺少截止时间");
  }
  if (synced.status === "ACTIVE") {
    // 延长截止：必须晚于原截止时间
    if (synced.endAt && endAt.getTime() <= synced.endAt.getTime()) {
      throw new ApiError(400, "新的截止时间必须晚于原截止时间");
    }
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { endAt },
    });
    return serializeProject(updated);
  }
  // CLOSED：重新开放（新截止时间须在未来 → ACTIVE），否则仅改时间
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      endAt,
      ...(endAt.getTime() > Date.now() ? { status: "ACTIVE" as const } : {}),
    },
  });
  return serializeProject(updated);
}

/** 发布（DRAFT → PUBLISHED）：校验时间与权重；问卷/评价关系校验在 Sprint 3/4 补充 */
export async function publishProject(
  projectId: string,
  user: User,
): Promise<ProjectDTO> {
  const project = await requireProjectAdmin(projectId, user);
  if (project.status !== "DRAFT") {
    throw new ApiError(409, "只有草稿状态的项目可以发布");
  }
  if (!project.startAt || !project.endAt) {
    throw new ApiError(400, "发布前必须设置开始时间和截止时间");
  }
  if (project.startAt.getTime() >= project.endAt.getTime()) {
    throw new ApiError(400, "开始时间必须早于截止时间");
  }
  if (
    !weightsSumTo100(
      project.managerWeight.toNumber(),
      project.peerWeight.toNumber(),
      project.subordinateWeight.toNumber(),
    )
  ) {
    throw new ApiError(400, "关系权重合计必须等于 100%");
  }
  // TODO(Sprint 3): 校验问卷已配置（至少一个维度和题目）
  // TODO(Sprint 4): 校验被评人与评价关系已配置
  const now = Date.now();
  const status = project.startAt.getTime() <= now ? "ACTIVE" : "PUBLISHED";
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status },
  });
  return serializeProject(updated);
}

/** 提前结束（ACTIVE → CLOSED）：截止时间改为当前时刻 */
export async function closeProject(
  projectId: string,
  user: User,
): Promise<ProjectDTO> {
  const project = await requireProjectAdmin(projectId, user);
  const synced = await syncStatus(project);
  if (synced.status !== "ACTIVE") {
    throw new ApiError(409, "只有测评中的项目可以提前结束");
  }
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status: "CLOSED", endAt: new Date() },
  });
  return serializeProject(updated);
}

/** 冻结（CLOSED → FROZEN）：形成正式结果；评分快照在 Sprint 8 补充 */
export async function freezeProject(
  projectId: string,
  user: User,
): Promise<ProjectDTO> {
  const project = await requireProjectAdmin(projectId, user);
  if (project.status !== "CLOSED") {
    throw new ApiError(409, "只有已截止的项目可以冻结");
  }
  // TODO(Sprint 8): 冻结时生成评分快照（正式结果固定）
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status: "FROZEN", frozenAt: new Date(), frozenBy: user.id },
  });
  return serializeProject(updated);
}

/** 解冻（FROZEN → CLOSED）：仅系统管理员（PRD 6.3） */
export async function unfreezeProject(
  projectId: string,
  user: User,
): Promise<ProjectDTO> {
  await requireSystemAdmin(user);
  const project = await requireProjectAdmin(projectId, user);
  if (project.status !== "FROZEN") {
    throw new ApiError(409, "只有已冻结的项目可以解冻");
  }
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status: "CLOSED", frozenAt: null, frozenBy: null },
  });
  return serializeProject(updated);
}

/** 归档（FROZEN → ARCHIVED） */
export async function archiveProject(
  projectId: string,
  user: User,
): Promise<ProjectDTO> {
  const project = await requireProjectAdmin(projectId, user);
  if (project.status !== "FROZEN") {
    throw new ApiError(409, "只有已冻结的项目可以归档");
  }
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status: "ARCHIVED" },
  });
  return serializeProject(updated);
}

/** 软删除（任何状态 → DELETED）：仅系统管理员；30 天后可物理清除（技术文档第 58 节） */
export async function deleteProject(
  projectId: string,
  user: User,
): Promise<void> {
  await requireSystemAdmin(user);
  const project = await requireProjectAdmin(projectId, user);
  if (project.status === "DELETED") {
    throw new ApiError(409, "项目已在回收站中");
  }
  const now = new Date();
  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: "DELETED",
      deletedAt: now,
      purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

// ---------- 项目管理员（HR）配置 ----------

export async function listAdmins(
  projectId: string,
  user: User,
): Promise<ProjectAdminDTO[]> {
  await requireProjectAdmin(projectId, user);
  const admins = await prisma.projectAdmin.findMany({
    where: { projectId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  return admins.map((a) => ({
    id: a.id,
    userId: a.userId,
    employeeNo: a.user.employeeNo,
    name: a.user.name,
    createdAt: a.createdAt.toISOString(),
  }));
}

/** 添加管理员：按工号查找用户（用户必须已存在于系统，即至少登录过一次） */
export async function addAdmin(
  projectId: string,
  user: User,
  employeeNo: unknown,
): Promise<ProjectAdminDTO> {
  await requireProjectAdmin(projectId, user);
  const no = typeof employeeNo === "string" ? employeeNo.trim() : "";
  if (!no) throw new ApiError(400, "工号不能为空");
  const target = await prisma.user.findUnique({ where: { employeeNo: no } });
  if (!target)
    throw new ApiError(404, "未找到该工号对应的用户（用户需先登录过一次）");
  const existing = await prisma.projectAdmin.findUnique({
    where: { projectId_userId: { projectId, userId: target.id } },
  });
  if (existing) throw new ApiError(409, "该用户已是项目管理员");
  const admin = await prisma.projectAdmin.create({
    data: { projectId, userId: target.id },
    include: { user: true },
  });
  return {
    id: admin.id,
    userId: admin.userId,
    employeeNo: admin.user.employeeNo,
    name: admin.user.name,
    createdAt: admin.createdAt.toISOString(),
  };
}

export async function removeAdmin(
  projectId: string,
  user: User,
  adminId: string,
): Promise<void> {
  await requireProjectAdmin(projectId, user);
  const admin = await prisma.projectAdmin.findUnique({
    where: { id: adminId },
  });
  if (!admin || admin.projectId !== projectId)
    throw new ApiError(404, "该项目管理员不存在");
  const count = await prisma.projectAdmin.count({ where: { projectId } });
  if (count <= 1) throw new ApiError(409, "不能移除最后一个项目管理员");
  await prisma.projectAdmin.delete({ where: { id: adminId } });
}

// ---------- 评分档位配置（PRD 第 10 节：只能改 label，不能增删档位） ----------

export async function listScales(
  projectId: string,
  user: User,
): Promise<ProjectScaleDTO[]> {
  await requireProjectAdmin(projectId, user);
  const scales = await prisma.projectScale.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  return scales.map(serializeScale);
}

/** 批量更新档位文字说明：只接受 label，value/order 由系统固定 */
export async function updateScaleLabels(
  projectId: string,
  user: User,
  items: unknown,
): Promise<ProjectScaleDTO[]> {
  await requireProjectAdmin(projectId, user);
  if (!Array.isArray(items)) throw new ApiError(400, "请求格式错误");
  const parsed = items.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { id?: unknown }).id !== "string" ||
      typeof (item as { label?: unknown }).label !== "string"
    ) {
      throw new ApiError(400, "请求格式错误");
    }
    const label = (item as { label: string }).label.trim();
    if (!label) throw new ApiError(400, "档位说明不能为空");
    if (label.length > 50) throw new ApiError(400, "档位说明不能超过 50 字");
    return { id: (item as { id: string }).id, label };
  });
  const scales = await prisma.projectScale.findMany({ where: { projectId } });
  const validIds = new Set(scales.map((s) => s.id));
  for (const item of parsed) {
    if (!validIds.has(item.id)) throw new ApiError(404, "评分档位不存在");
  }
  await prisma.$transaction(
    parsed.map((item) =>
      prisma.projectScale.update({
        where: { id: item.id },
        data: { label: item.label },
      }),
    ),
  );
  const updated = await prisma.projectScale.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  return updated.map(serializeScale);
}
