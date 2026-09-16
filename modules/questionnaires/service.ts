import type {
  Dimension,
  Prisma,
  Question,
  User,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, requireProjectAdmin } from "@/lib/permissions";
import { syncStatus } from "@/modules/projects/service";
import { parseQuestionnaireExcel, type ParseRowError } from "./excel";
import {
  validateQuestionnaire,
  type QuestionnaireData,
  type RelationFlags,
  type ValidationError,
} from "./validate";

/**
 * 问卷服务（技术文档第 13~15、40 节 / PRD 第 11、12、13 节）。
 *
 * - 每个项目最多一份问卷（Questionnaire.projectId unique；重复导入 = 整体替换）
 * - 修改窗口：项目 DRAFT/PUBLISHED 且未锁定（lockedAt 在首次正式提交后由 Sprint 5 设置）
 * - 模板：projectId=null + isTemplate=true；save-as-template / from-template 深拷贝维度与题目
 */

export type QuestionDTO = {
  code: string;
  type: "RATING" | "TEXT";
  title: string;
  description: string | null;
  weight: number | null;
  required: boolean;
  order: number;
  overrideRelationRules: boolean;
  applicableSelf: boolean;
  applicableManager: boolean;
  applicablePeer: boolean;
  applicableSubordinate: boolean;
};

export type DimensionDTO = {
  name: string;
  description: string | null;
  weight: number;
  order: number;
  applicableSelf: boolean;
  applicableManager: boolean;
  applicablePeer: boolean;
  applicableSubordinate: boolean;
  children: DimensionDTO[];
  questions: QuestionDTO[];
};

export type QuestionnaireDTO = {
  id: string;
  lockedAt: string | null;
  dimensionCount: number;
  questionCount: number;
  dimensions: DimensionDTO[];
};

export type TemplateDTO = {
  id: string;
  templateName: string;
  dimensionCount: number;
  questionCount: number;
  /** 模板创建者（用于前端判断能否改名/删除）；迁移前的旧模板为空 */
  createdById: string | null;
  createdAt: string;
};

export type ImportCheckResult = {
  parseErrors: ParseRowError[];
  validationErrors: ValidationError[];
};

// ---------- 内部树表示（Excel 导入与模板复制共用） ----------

type QuestionNode = {
  code: string;
  type: "RATING" | "TEXT";
  title: string;
  description: string | null;
  weight: number | null;
  required: boolean;
  order: number;
  overrideRelationRules: boolean;
  applicable: RelationFlags;
};

type DimensionNode = {
  name: string;
  description: string | null;
  weight: number;
  order: number;
  applicable: RelationFlags;
  children: DimensionNode[];
  questions: QuestionNode[];
};

/** 把 Excel 解析出的扁平中间表示组装成写入用的树 */
function dataToTree(data: QuestionnaireData): DimensionNode[] {
  const byKey = new Map(data.dimensions.map((d) => [d.key, d]));
  const toQuestion = (dimensionKey: string): QuestionNode[] =>
    data.questions
      .filter((q) => q.dimensionKey === dimensionKey)
      .map((q) => ({
        code: q.code,
        type: q.type,
        title: q.title,
        description: q.description ?? null,
        weight: q.weight,
        required: q.required,
        order: q.order,
        overrideRelationRules: q.overrideRelationRules,
        applicable: q.applicable,
      }));
  const toNode = (key: string): DimensionNode => {
    const dim = byKey.get(key)!;
    return {
      name: dim.name,
      description: dim.description ?? null,
      weight: dim.weight,
      order: dim.order,
      applicable: dim.applicable,
      children: data.dimensions
        .filter((d) => d.parentKey === key)
        .map((d) => toNode(d.key)),
      questions: toQuestion(key),
    };
  };
  return data.dimensions
    .filter((d) => d.parentKey === null)
    .map((d) => toNode(d.key));
}

type DbDimension = Dimension & { questions: Question[] };

function dbToTree(
  dims: Array<DbDimension & { children: DbDimension[] }>,
): DimensionNode[] {
  const convert = (d: DbDimension, children: DbDimension[]): DimensionNode => ({
    name: d.name,
    description: d.description,
    weight: d.weight.toNumber(),
    order: d.order,
    applicable: {
      self: d.applicableSelf,
      manager: d.applicableManager,
      peer: d.applicablePeer,
      subordinate: d.applicableSubordinate,
    },
    children: children.map((c) => convert(c, [])),
    questions: d.questions.map((q) => ({
      code: q.code,
      type: q.type,
      title: q.title,
      description: q.description,
      weight: q.weight === null ? null : q.weight.toNumber(),
      required: q.required,
      order: q.order,
      overrideRelationRules: q.overrideRelationRules,
      applicable: {
        self: q.applicableSelf,
        manager: q.applicableManager,
        peer: q.applicablePeer,
        subordinate: q.applicableSubordinate,
      },
    })),
  });
  return dims.map((d) => convert(d, d.children));
}

function dimensionFields(dim: DimensionNode) {
  return {
    name: dim.name,
    description: dim.description,
    weight: dim.weight,
    order: dim.order,
    applicableSelf: dim.applicable.self,
    applicableManager: dim.applicable.manager,
    applicablePeer: dim.applicable.peer,
    applicableSubordinate: dim.applicable.subordinate,
  };
}

function questionFields(q: QuestionNode) {
  return {
    code: q.code,
    type: q.type,
    title: q.title,
    description: q.description,
    weight: q.weight,
    required: q.required,
    order: q.order,
    overrideRelationRules: q.overrideRelationRules,
    applicableSelf: q.applicable.self,
    applicableManager: q.applicable.manager,
    applicablePeer: q.applicable.peer,
    applicableSubordinate: q.applicable.subordinate,
  };
}

/** 事务内写入维度树（一级 → 题目 → 二级 → 题目；规模 ≤ 200 人项目问卷量级，逐条写入即可） */
async function createDimensionsWithQuestions(
  tx: Prisma.TransactionClient,
  questionnaireId: string,
  tree: DimensionNode[],
): Promise<void> {
  for (const dim of tree) {
    const parent = await tx.dimension.create({
      data: { questionnaireId, ...dimensionFields(dim) },
    });
    if (dim.questions.length > 0) {
      await tx.question.createMany({
        data: dim.questions.map((q) => ({
          dimensionId: parent.id,
          ...questionFields(q),
        })),
      });
    }
    for (const child of dim.children) {
      const sub = await tx.dimension.create({
        data: {
          questionnaireId,
          parentId: parent.id,
          ...dimensionFields(child),
        },
      });
      if (child.questions.length > 0) {
        await tx.question.createMany({
          data: child.questions.map((q) => ({
            dimensionId: sub.id,
            ...questionFields(q),
          })),
        });
      }
    }
  }
}

/** 事务内整体替换项目问卷（删旧写新） */
async function replaceProjectQuestionnaire(
  projectId: string,
  tree: DimensionNode[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.questionnaire.deleteMany({ where: { projectId } });
    const questionnaire = await tx.questionnaire.create({
      data: { projectId },
    });
    await createDimensionsWithQuestions(tx, questionnaire.id, tree);
  });
}

/** 读取整棵维度树（一级 → 二级 → 题目，均按 order 排序） */
async function loadDbTree(questionnaireId: string): Promise<DimensionNode[]> {
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
  return dbToTree(dims);
}

function countTree(tree: DimensionNode[]): {
  dimensionCount: number;
  questionCount: number;
} {
  let dimensionCount = 0;
  let questionCount = 0;
  const walk = (dims: DimensionNode[]) => {
    for (const d of dims) {
      dimensionCount += 1;
      questionCount += d.questions.length;
      walk(d.children);
    }
  };
  walk(tree);
  return { dimensionCount, questionCount };
}

function treeToDto(
  questionnaireId: string,
  lockedAt: Date | null,
  tree: DimensionNode[],
): QuestionnaireDTO {
  const toDimensionDto = (dim: DimensionNode): DimensionDTO => ({
    name: dim.name,
    description: dim.description,
    weight: dim.weight,
    order: dim.order,
    applicableSelf: dim.applicable.self,
    applicableManager: dim.applicable.manager,
    applicablePeer: dim.applicable.peer,
    applicableSubordinate: dim.applicable.subordinate,
    children: dim.children.map(toDimensionDto),
    questions: dim.questions.map(questionDto),
  });
  const { dimensionCount, questionCount } = countTree(tree);
  return {
    id: questionnaireId,
    lockedAt: lockedAt?.toISOString() ?? null,
    dimensionCount,
    questionCount,
    dimensions: tree.map(toDimensionDto),
  };
}

function questionDto(q: QuestionNode): QuestionDTO {
  return {
    code: q.code,
    type: q.type,
    title: q.title,
    description: q.description,
    weight: q.weight,
    required: q.required,
    order: q.order,
    overrideRelationRules: q.overrideRelationRules,
    applicableSelf: q.applicable.self,
    applicableManager: q.applicable.manager,
    applicablePeer: q.applicable.peer,
    applicableSubordinate: q.applicable.subordinate,
  };
}

// ---------- 修改窗口守卫 ----------

/** 问卷可修改条件：项目管理员 + 项目 DRAFT/PUBLISHED（含惰性同步）+ 未锁定 */
async function requireEditableQuestionnaire(
  projectId: string,
  user: User,
): Promise<void> {
  const project = await syncStatus(await requireProjectAdmin(projectId, user));
  if (project.status !== "DRAFT" && project.status !== "PUBLISHED") {
    throw new ApiError(409, "测评开始后不能修改问卷");
  }
  const existing = await prisma.questionnaire.findUnique({
    where: { projectId },
  });
  if (existing?.lockedAt) {
    throw new ApiError(409, "问卷已锁定（已有正式提交），不能修改");
  }
}

// ---------- 查询 ----------

/** 项目问卷树（未导入时返回 null） */
export async function getProjectQuestionnaire(
  projectId: string,
  user: User,
): Promise<QuestionnaireDTO | null> {
  await requireProjectAdmin(projectId, user);
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { projectId },
  });
  if (!questionnaire) return null;
  const tree = await loadDbTree(questionnaire.id);
  return treeToDto(questionnaire.id, questionnaire.lockedAt, tree);
}

/** 模板列表（模板库对所有登录用户可见，PRD 第 13 节；登录校验由 route 层完成） */
export async function listTemplates(): Promise<TemplateDTO[]> {
  const templates = await prisma.questionnaire.findMany({
    where: { isTemplate: true },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    templates.map(async (t) => {
      const tree = await loadDbTree(t.id);
      const dto = treeToDto(t.id, null, tree);
      return {
        id: t.id,
        templateName: t.templateName ?? "未命名模板",
        dimensionCount: dto.dimensionCount,
        questionCount: dto.questionCount,
        createdById: t.createdById,
        createdAt: t.createdAt.toISOString(),
      };
    }),
  );
}

// ---------- Excel 校验与导入 ----------

/** 只校验不写入：解析 + 结构/权重校验，返回完整错误报告 */
export async function checkQuestionnaireExcel(
  buffer: Buffer,
): Promise<ImportCheckResult> {
  const { data, errors: parseErrors } = await parseQuestionnaireExcel(buffer);
  const validationErrors =
    parseErrors.length > 0 ? [] : validateQuestionnaire(data);
  return { parseErrors, validationErrors };
}

/** Excel 导入：解析 → 校验 → 事务整体替换项目问卷 */
export async function importQuestionnaire(
  projectId: string,
  user: User,
  buffer: Buffer,
): Promise<QuestionnaireDTO> {
  await requireEditableQuestionnaire(projectId, user);
  const { data, errors: parseErrors } = await parseQuestionnaireExcel(buffer);
  if (parseErrors.length > 0) {
    throw new ApiError(400, "Excel 格式存在错误，请修正后重试", {
      parseErrors,
    });
  }
  const validationErrors = validateQuestionnaire(data);
  if (validationErrors.length > 0) {
    throw new ApiError(400, "问卷校验未通过，请修正后重试", {
      validationErrors,
    });
  }
  await replaceProjectQuestionnaire(projectId, dataToTree(data));
  return (await getProjectQuestionnaire(projectId, user))!;
}

// ---------- 在线编辑保存（PRD 第 12.1 节） ----------

/**
 * 在线搭建 / 编辑：整树保存（替换项目问卷的维度与题目）。
 *
 * 设计要点：
 * - 复用 Excel 导入的同一套中间表示与校验规则（validate.ts），保证两条路径口径一致
 * - **允许保存「校验未通过」的中间状态**：编辑是持续过程（先搭结构再配权重），
 *   若强制校验通过就无法保存；完整性由发布前校验兜底（见 validate-project.ts）
 * - 整树替换不会丢失草稿：草稿写入窗口是项目 ACTIVE，而此处守卫要求 DRAFT/PUBLISHED
 *   且问卷未锁定，两者互斥（saveDraft 的 ACTIVE 守卫见 review-tasks/service.ts）
 */
export async function saveProjectQuestionnaire(
  projectId: string,
  user: User,
  body: unknown,
): Promise<{
  questionnaire: QuestionnaireDTO;
  validationErrors: ValidationError[];
}> {
  await requireEditableQuestionnaire(projectId, user);
  const data = parseEditorInput(body);
  const validationErrors = validateQuestionnaire(data);
  await replaceProjectQuestionnaire(projectId, dataToTree(data));
  return {
    questionnaire: (await getProjectQuestionnaire(projectId, user))!,
    validationErrors,
  };
}

function parseEditorInput(body: unknown): QuestionnaireData {
  const raw = (body ?? {}) as { dimensions?: unknown; questions?: unknown };
  if (!Array.isArray(raw.dimensions) || !Array.isArray(raw.questions)) {
    throw new ApiError(400, "请求体必须包含 dimensions 与 questions 数组");
  }
  const dimensions: QuestionnaireData["dimensions"] = raw.dimensions.map(
    (item, index) => parseEditorDimension(item, index),
  );
  const questions: QuestionnaireData["questions"] = raw.questions.map(
    (item, index) => parseEditorQuestion(item, index),
  );

  const keys = new Set<string>();
  for (const dim of dimensions) {
    if (keys.has(dim.key)) {
      throw new ApiError(400, `维度 key 重复：${dim.key}`);
    }
    keys.add(dim.key);
  }
  for (const q of questions) {
    if (!keys.has(q.dimensionKey)) {
      throw new ApiError(400, `题目 ${q.code} 引用的维度不存在`);
    }
  }
  return { dimensions, questions };
}

function parseEditorDimension(
  item: unknown,
  index: number,
): QuestionnaireData["dimensions"][number] {
  const where = `dimensions[${index}]`;
  const raw = item as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new ApiError(400, `${where} 格式错误`);
  }
  const key = requireString(raw.key, `${where}.key`);
  const name = requireString(raw.name, `${where}.name`);
  const parentKey =
    raw.parentKey === null || raw.parentKey === undefined
      ? null
      : requireString(raw.parentKey, `${where}.parentKey`);
  return {
    key,
    parentKey,
    name,
    description: optionalString(raw.description, `${where}.description`),
    weight: requireNumber(raw.weight, `${where}.weight`),
    order: requireOrder(raw.order, `${where}.order`),
    applicable: requireRelationFlags(raw.applicable, `${where}.applicable`),
  };
}

function parseEditorQuestion(
  item: unknown,
  index: number,
): QuestionnaireData["questions"][number] {
  const where = `questions[${index}]`;
  const raw = item as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new ApiError(400, `${where} 格式错误`);
  }
  const type =
    raw.type === "TEXT" ? "TEXT" : raw.type === "RATING" ? "RATING" : null;
  if (!type) throw new ApiError(400, `${where}.type 必须为 RATING 或 TEXT`);
  const overrideRelationRules = raw.overrideRelationRules === true;
  return {
    dimensionKey: requireString(raw.dimensionKey, `${where}.dimensionKey`),
    code: requireString(raw.code, `${where}.code`),
    type,
    title: requireString(raw.title, `${where}.title`),
    description: optionalString(raw.description, `${where}.description`),
    // 开放题不设权重：入参带权重也忽略为空，与 Excel 导入口径一致
    weight:
      type === "TEXT" ? null : requireNumber(raw.weight, `${where}.weight`),
    required: raw.required !== false,
    order: requireOrder(raw.order, `${where}.order`),
    overrideRelationRules,
    applicable: overrideRelationRules
      ? requireRelationFlags(raw.applicable, `${where}.applicable`)
      : { self: true, manager: true, peer: true, subordinate: true },
  };
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `${where} 必须为非空字符串`);
  }
  return value.trim();
}

function optionalString(value: unknown, where: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(400, `${where} 必须为字符串`);
  }
  return value.trim() === "" ? null : value.trim();
}

function requireNumber(value: unknown, where: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new ApiError(400, `${where} 必须为 0~100 的数字`);
  }
  return value;
}

function requireOrder(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ApiError(400, `${where} 必须为非负整数`);
  }
  return value;
}

function requireRelationFlags(
  value: unknown,
  where: string,
): QuestionnaireData["dimensions"][number]["applicable"] {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new ApiError(400, `${where} 必须为对象`);
  }
  for (const flag of ["self", "manager", "peer", "subordinate"]) {
    if (typeof raw[flag] !== "boolean") {
      throw new ApiError(400, `${where}.${flag} 必须为布尔值`);
    }
  }
  return {
    self: raw.self as boolean,
    manager: raw.manager as boolean,
    peer: raw.peer as boolean,
    subordinate: raw.subordinate as boolean,
  };
}

// ---------- 模板 ----------

/** 保存为模板：深拷贝项目问卷（维度 + 题目） */
export async function saveAsTemplate(
  projectId: string,
  user: User,
  templateName: unknown,
): Promise<TemplateDTO> {
  await requireProjectAdmin(projectId, user);
  const name = typeof templateName === "string" ? templateName.trim() : "";
  if (!name) throw new ApiError(400, "模板名称不能为空");
  if (name.length > 100) throw new ApiError(400, "模板名称不能超过 100 字");

  const existing = await prisma.questionnaire.findFirst({
    where: { isTemplate: true, templateName: name },
  });
  if (existing) throw new ApiError(409, "已存在同名模板");

  const questionnaire = await prisma.questionnaire.findUnique({
    where: { projectId },
  });
  if (!questionnaire)
    throw new ApiError(404, "该项目还没有问卷，无法保存为模板");

  const tree = await loadDbTree(questionnaire.id);
  if (tree.length === 0) throw new ApiError(400, "问卷为空，无法保存为模板");

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.questionnaire.create({
      data: { isTemplate: true, templateName: name, createdById: user.id },
    });
    await createDimensionsWithQuestions(tx, created.id, tree);
    return created;
  });
  const dto = treeToDto(template.id, null, tree);
  return {
    id: template.id,
    templateName: name,
    dimensionCount: dto.dimensionCount,
    questionCount: dto.questionCount,
    createdById: template.createdById,
    createdAt: template.createdAt.toISOString(),
  };
}

/** 从模板复制到项目：整体替换项目问卷（受修改窗口限制） */
export async function applyTemplate(
  projectId: string,
  user: User,
  templateId: string,
): Promise<QuestionnaireDTO> {
  await requireEditableQuestionnaire(projectId, user);
  const template = await assertTemplate(templateId);
  const tree = await loadDbTree(template.id);
  await replaceProjectQuestionnaire(projectId, tree);
  return (await getProjectQuestionnaire(projectId, user))!;
}

/** 模板详情（维度树预览）：模板库对所有登录用户可见（PRD 第 13 节） */
export async function getTemplateDetail(
  templateId: string,
): Promise<QuestionnaireDTO> {
  const template = await assertTemplate(templateId);
  const tree = await loadDbTree(template.id);
  return treeToDto(template.id, null, tree);
}

/** 模板重命名：仅创建者或系统管理员 */
export async function renameTemplate(
  templateId: string,
  user: User,
  templateName: unknown,
): Promise<TemplateDTO> {
  await requireTemplateManager(templateId, user);
  const name = typeof templateName === "string" ? templateName.trim() : "";
  if (!name) throw new ApiError(400, "模板名称不能为空");
  if (name.length > 100) throw new ApiError(400, "模板名称不能超过 100 字");
  const duplicated = await prisma.questionnaire.findFirst({
    where: { isTemplate: true, templateName: name, id: { not: templateId } },
  });
  if (duplicated) throw new ApiError(409, "已存在同名模板");

  const updated = await prisma.questionnaire.update({
    where: { id: templateId },
    data: { templateName: name },
  });
  const tree = await loadDbTree(updated.id);
  const dto = treeToDto(updated.id, null, tree);
  return {
    id: updated.id,
    templateName: name,
    dimensionCount: dto.dimensionCount,
    questionCount: dto.questionCount,
    createdById: updated.createdById,
    createdAt: updated.createdAt.toISOString(),
  };
}

/** 删除模板：仅创建者或系统管理员。模板是深拷贝的独立数据，删除不影响任何项目问卷 */
export async function deleteTemplate(
  templateId: string,
  user: User,
): Promise<void> {
  await requireTemplateManager(templateId, user);
  // 级联删除该模板的维度与题目（Dimension/Question onDelete: Cascade）
  await prisma.questionnaire.delete({ where: { id: templateId } });
}

async function assertTemplate(templateId: string) {
  const template = await prisma.questionnaire.findUnique({
    where: { id: templateId },
  });
  if (!template || !template.isTemplate) {
    throw new ApiError(404, "问卷模板不存在");
  }
  return template;
}

/**
 * 模板管理权限：创建者本人或系统管理员。
 * 早期模板没有 createdById（迁移前创建），此时只有系统管理员可改名/删除，避免误删他人模板。
 */
async function requireTemplateManager(
  templateId: string,
  user: User,
): Promise<void> {
  const template = await assertTemplate(templateId);
  if (user.systemRole === "SYSTEM_ADMIN") return;
  if (template.createdById && template.createdById === user.id) return;
  throw new ApiError(403, "只有模板创建者或系统管理员可以修改模板");
}
