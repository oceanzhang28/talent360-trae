import type { RelationType } from "@/app/generated/prisma/client";

/**
 * 评价端纯函数（PRD 第 11 节 / 技术文档第 19~21、42 节）。
 * 问卷按关系过滤、草稿载荷校验、提交必答校验——全部无副作用，便于单元测试。
 */

// ---------- 问卷视图（评价人视角，含题目 id 供草稿定位） ----------

export type TaskQuestion = {
  id: string;
  code: string;
  type: "RATING" | "TEXT";
  title: string;
  description: string | null;
  required: boolean;
};

export type TaskDimension = {
  id: string;
  name: string;
  description: string | null;
  children: TaskDimension[];
  questions: TaskQuestion[];
};

/** 原始题目（数据库字段子集） */
export type RawQuestion = {
  id: string;
  code: string;
  type: "RATING" | "TEXT";
  title: string;
  description: string | null;
  required: boolean;
  order: number;
  overrideRelationRules: boolean;
  applicableSelf: boolean;
  applicableManager: boolean;
  applicablePeer: boolean;
  applicableSubordinate: boolean;
};

/** 原始维度（数据库字段子集，含二级与题目） */
export type RawDimension = {
  id: string;
  name: string;
  description: string | null;
  order: number;
  applicableSelf: boolean;
  applicableManager: boolean;
  applicablePeer: boolean;
  applicableSubordinate: boolean;
  children: RawDimension[];
  questions: RawQuestion[];
};

const DIMENSION_APPLICABLE: Record<
  RelationType,
  keyof Pick<
    RawDimension,
    | "applicableSelf"
    | "applicableManager"
    | "applicablePeer"
    | "applicableSubordinate"
  >
> = {
  SELF: "applicableSelf",
  MANAGER: "applicableManager",
  PEER: "applicablePeer",
  SUBORDINATE: "applicableSubordinate",
};

/** 题目对关系是否可见：未覆盖时继承维度规则（维度已在上层过滤），覆盖后按题目自身规则 */
function questionApplicable(q: RawQuestion, relation: RelationType): boolean {
  return q.overrideRelationRules ? q[DIMENSION_APPLICABLE[relation]] : true;
}

/** 按关系过滤问卷树：维度级 applicable + 题目级 override（PRD 第 11 节） */
export function filterTreeForRelation(
  dims: RawDimension[],
  relation: RelationType,
): TaskDimension[] {
  const field = DIMENSION_APPLICABLE[relation];
  const convert = (dim: RawDimension): TaskDimension => ({
    id: dim.id,
    name: dim.name,
    description: dim.description,
    children: dim.children.filter((c) => c[field]).map(convert),
    questions: dim.questions
      .filter((q) => questionApplicable(q, relation))
      .map((q) => ({
        id: q.id,
        code: q.code,
        type: q.type,
        title: q.title,
        description: q.description,
        required: q.required,
      })),
  });
  return dims.filter((d) => d[field]).map(convert);
}

/** 展平过滤后的树中的全部题目（提交必答校验用） */
export function flattenQuestions(dims: TaskDimension[]): TaskQuestion[] {
  const out: TaskQuestion[] = [];
  const walk = (list: TaskDimension[]) => {
    for (const d of list) {
      out.push(...d.questions);
      walk(d.children);
    }
  };
  walk(dims);
  return out;
}

// ---------- 草稿载荷校验（PUT /api/tasks/:id/draft） ----------

export type DraftAnswerInput = {
  questionId: string;
  score: number | null;
  textValue: string | null;
};

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const MAX_ANSWERS = 500;
const MAX_TEXT_LENGTH = 2000;

function isValidScore(value: number): boolean {
  // 固定 10 档：0.5 ~ 5.0，步长 0.5（PRD 第 10 节）
  return (
    Number.isFinite(value) &&
    value >= 0.5 &&
    value <= 5 &&
    Math.round(value * 2) === value * 2
  );
}

/**
 * 校验草稿载荷：只允许写入「该关系适用的题目」的对应类型字段。
 * - RATING：score 必须 0.5~5.0 步长 0.5，不允许文本
 * - TEXT：textValue ≤ 2000 字，不允许分数
 * - score/textValue 均为 null 表示清空该题草稿
 */
export function validateDraftAnswers(
  answers: unknown,
  applicableById: Map<string, TaskQuestion>,
): DraftAnswerInput[] {
  if (!Array.isArray(answers)) {
    throw new DraftValidationError("answers 必须是数组");
  }
  if (answers.length > MAX_ANSWERS) {
    throw new DraftValidationError(`单次最多提交 ${MAX_ANSWERS} 条答案`);
  }
  const seen = new Set<string>();
  const out: DraftAnswerInput[] = [];
  for (const raw of answers) {
    if (typeof raw !== "object" || raw === null) {
      throw new DraftValidationError("答案格式错误");
    }
    const { questionId, score, textValue } = raw as Record<string, unknown>;
    if (typeof questionId !== "string" || !questionId) {
      throw new DraftValidationError("questionId 不能为空");
    }
    const question = applicableById.get(questionId);
    if (!question) {
      throw new DraftValidationError("题目不存在或不适用于当前评价关系");
    }
    if (seen.has(questionId)) {
      throw new DraftValidationError("答案存在重复题目");
    }
    seen.add(questionId);

    const hasScore = score !== undefined && score !== null;
    const hasText =
      textValue !== undefined && textValue !== null && textValue !== "";

    if (hasScore && typeof score !== "number") {
      throw new DraftValidationError(`${question.code} 分数格式错误`);
    }
    if (hasText && typeof textValue !== "string") {
      throw new DraftValidationError(`${question.code} 文本格式错误`);
    }
    if (question.type === "RATING") {
      if (hasText) {
        throw new DraftValidationError(
          `${question.code} 是量表题，不能填写文本`,
        );
      }
      if (hasScore && !isValidScore(score as number)) {
        throw new DraftValidationError(
          `${question.code} 分数必须为 0.5~5.0（步长 0.5）`,
        );
      }
    } else {
      if (hasScore) {
        throw new DraftValidationError(
          `${question.code} 是开放题，不能填写分数`,
        );
      }
      if (typeof textValue === "string" && textValue.length > MAX_TEXT_LENGTH) {
        throw new DraftValidationError(
          `${question.code} 文本不能超过 ${MAX_TEXT_LENGTH} 字`,
        );
      }
    }

    out.push({
      questionId,
      score: hasScore ? (score as number) : null,
      textValue: hasText ? (textValue as string) : null,
    });
  }
  return out;
}

// ---------- 提交必答校验（POST /api/tasks/:id/submit） ----------

export type AnswerLike = {
  score: number | null;
  textValue: string | null;
};

/** 找出未完成的必答项：RATING 必答必须有分数；TEXT 必答必须非空文本 */
export function findMissingRequired(
  questions: TaskQuestion[],
  answers: Map<string, AnswerLike>,
): TaskQuestion[] {
  return questions.filter((q) => {
    if (!q.required) return false;
    const a = answers.get(q.id);
    if (q.type === "RATING") return !a || a.score === null;
    return !a || a.textValue === null || a.textValue.trim() === "";
  });
}
