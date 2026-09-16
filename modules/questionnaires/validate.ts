/**
 * 问卷完整性校验（技术文档第 14/15 节 + PRD 第 12 节）。
 * 纯函数：输入问卷中间表示，输出错误列表；Excel 导入与发布前校验共用。
 *
 * 规则：
 * 1. 维度树最大两级
 * 2. 同一一级维度不能同时直接挂题目和二级维度（避免评分歧义）
 * 3. 一级维度权重合计 = 100%
 * 4. 有一级下挂二级维度时：二级维度权重合计 = 100%；直接挂题目时：RATING 题权重合计 = 100%
 * 5. 每个二级维度下 RATING 题权重合计 = 100%
 * 6. TEXT 题权重必须为空、RATING 题必答
 * 7. 题目编号问卷内唯一
 * 8. 维度 / 题目至少适用一种评价关系
 */

export type RelationFlags = {
  self: boolean;
  manager: boolean;
  peer: boolean;
  subordinate: boolean;
};

export type DimensionInput = {
  key: string;
  parentKey: string | null;
  name: string;
  description?: string | null;
  weight: number;
  order: number;
  applicable: RelationFlags;
};

export type QuestionInput = {
  dimensionKey: string;
  code: string;
  type: "RATING" | "TEXT";
  title: string;
  description?: string | null;
  weight: number | null;
  required: boolean;
  order: number;
  overrideRelationRules: boolean;
  applicable: RelationFlags;
};

export type QuestionnaireData = {
  dimensions: DimensionInput[];
  questions: QuestionInput[];
};

export type ValidationError = {
  /** 人可读路径：一级维度 > 二级维度 > 题目编号 */
  path: string;
  message: string;
};

/** 权重合计是否 100%（以 1% 为单位取整求和，避免浮点误差） */
export function weightSumIs100(weights: number[]): boolean {
  return weights.reduce((sum, w) => sum + Math.round(w * 100), 0) === 10000;
}

function applicableCount(flags: RelationFlags): number {
  return (
    Number(flags.self) +
    Number(flags.manager) +
    Number(flags.peer) +
    Number(flags.subordinate)
  );
}

export function validateQuestionnaire(
  data: QuestionnaireData,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const dims = new Map<string, DimensionInput>();
  for (const dim of data.dimensions) {
    dims.set(dim.key, dim);
  }

  // 维度引用校 + 树层级校验
  for (const dim of data.dimensions) {
    if (dim.parentKey !== null) {
      const parent = dims.get(dim.parentKey);
      if (!parent) {
        errors.push({ path: dim.name, message: "引用的上级维度不存在" });
        continue;
      }
      if (parent.parentKey !== null) {
        errors.push({
          path: `${parent.name} > ${dim.name}`,
          message: "维度树最大两级，不能再挂三级维度",
        });
      }
    }
    if (applicableCount(dim.applicable) === 0) {
      errors.push({ path: dim.name, message: "维度至少需要适用一种评价关系" });
    }
  }

  // 一级维度权重合计
  const topLevel = data.dimensions.filter((d) => d.parentKey === null);
  if (topLevel.length === 0) {
    errors.push({ path: "问卷", message: "至少需要一个一级维度" });
  } else if (!weightSumIs100(topLevel.map((d) => d.weight))) {
    errors.push({
      path: "一级维度",
      message: `权重合计必须等于 100%（当前 ${formatSum(topLevel.map((d) => d.weight))}%）`,
    });
  }

  // 每个一级维度：二级权重合计 / 直接挂题的题目权重合计
  for (const dim of topLevel) {
    const children = data.dimensions.filter((d) => d.parentKey === dim.key);
    const directQuestions = data.questions.filter(
      (q) => q.dimensionKey === dim.key,
    );
    if (children.length > 0 && directQuestions.length > 0) {
      errors.push({
        path: dim.name,
        message: "同一一级维度不能同时直接挂题目和二级维度",
      });
    }
    if (children.length > 0) {
      if (!weightSumIs100(children.map((c) => c.weight))) {
        errors.push({
          path: dim.name,
          message: `下级二级维度权重合计必须等于 100%（当前 ${formatSum(children.map((c) => c.weight))}%）`,
        });
      }
    } else if (directQuestions.length > 0) {
      checkQuestionWeights(errors, dim.name, directQuestions);
    } else {
      errors.push({ path: dim.name, message: "维度下没有题目" });
    }
  }

  // 每个二级维度：题目权重合计
  for (const dim of data.dimensions.filter((d) => d.parentKey !== null)) {
    const parent = dims.get(dim.parentKey!);
    const path = parent ? `${parent.name} > ${dim.name}` : dim.name;
    const questions = data.questions.filter((q) => q.dimensionKey === dim.key);
    if (questions.length === 0) {
      errors.push({ path, message: "维度下没有题目" });
    } else {
      checkQuestionWeights(errors, path, questions);
    }
  }

  // 题目编号唯一性
  const codeCount = new Map<string, number>();
  for (const q of data.questions) {
    codeCount.set(q.code, (codeCount.get(q.code) ?? 0) + 1);
  }
  for (const q of data.questions) {
    const dim = dims.get(q.dimensionKey);
    const path = dim ? `${dimensionPath(dims, dim)} > ${q.code}` : q.code;
    if ((codeCount.get(q.code) ?? 0) > 1) {
      errors.push({ path, message: `题目编号「${q.code}」在问卷内重复` });
    }
    if (q.type === "TEXT" && q.weight !== null) {
      errors.push({ path, message: "开放题（TEXT）不能设置权重" });
    }
    if (q.type === "RATING" && !q.required) {
      errors.push({ path, message: "量表题（RATING）必须为必答" });
    }
    if (q.type === "RATING" && q.weight === null) {
      errors.push({ path, message: "量表题（RATING）必须设置权重" });
    }
    if (q.overrideRelationRules && applicableCount(q.applicable) === 0) {
      errors.push({
        path,
        message: "题目覆盖适用关系后至少需要适用一种评价关系",
      });
    }
  }

  // 悬空题目（引用不存在的维度）
  for (const q of data.questions) {
    if (!dims.has(q.dimensionKey)) {
      errors.push({ path: q.code, message: "题目引用的维度不存在" });
    }
  }

  return errors;
}

function checkQuestionWeights(
  errors: ValidationError[],
  path: string,
  questions: QuestionInput[],
): void {
  const ratingWeights = questions
    .filter((q) => q.type === "RATING")
    .map((q) => q.weight ?? 0);
  if (ratingWeights.length === 0) {
    errors.push({ path, message: "维度下没有量表题（RATING）" });
    return;
  }
  if (!weightSumIs100(ratingWeights)) {
    errors.push({
      path,
      message: `量表题权重合计必须等于 100%（当前 ${formatSum(ratingWeights)}%）`,
    });
  }
}

function dimensionPath(
  dims: Map<string, DimensionInput>,
  dim: DimensionInput,
): string {
  if (dim.parentKey === null) return dim.name;
  const parent = dims.get(dim.parentKey);
  return parent ? `${parent.name} > ${dim.name}` : dim.name;
}

function formatSum(weights: number[]): string {
  const sum = weights.reduce((s, w) => s + w, 0);
  return String(Math.round(sum * 100) / 100);
}
