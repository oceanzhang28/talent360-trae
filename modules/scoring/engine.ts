import Decimal from "decimal.js";
import type {
  DimensionScoreDetail,
  QuestionScoreDetail,
  ScoringDimension,
  ScoringInput,
  ScoringQuestion,
  ScoringRelation,
  ScoringRelationWeights,
  ScoringResult,
  ScoringSubmission,
  RelationScoreDetail,
} from "./types";

/**
 * 360 评分引擎（技术文档第 27~33 节 / PRD 第 31~34 节）。
 *
 * 计算链：题目平均 → 题目权重归一化 → 二级维度 → 一级维度 → 关系得分 → 360 总分。
 * 纯函数 + decimal.js 全程 Decimal 运算，中间计算永不舍入（AGENTS.md 铁律 8）；
 * 仅 MANAGER / PEER / SUBORDINATE 参与 360 总分，SELF 不参与（铁律 7）。
 *
 * 归一化总原则（PRD 第 32/34 节）：各级权重在「实际参与计分的有效集合」内归一化——
 * 不可见的题目/维度直接剔除，可见但无有效评分的同样剔除，剩余成员按原始权重比例重新分配。
 */

/** 非法问卷结构（混合挂载 / 超两级嵌套 / 悬空引用），fail fast 防止静默丢数据 */
export class ScoringStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringStructureError";
  }
}

const APPLICABLE_FIELD: Record<
  ScoringRelation,
  | "applicableSelf"
  | "applicableManager"
  | "applicablePeer"
  | "applicableSubordinate"
> = {
  SELF: "applicableSelf",
  MANAGER: "applicableManager",
  PEER: "applicablePeer",
  SUBORDINATE: "applicableSubordinate",
};

const RELATION_ORDER: ScoringRelation[] = [
  "SELF",
  "MANAGER",
  "PEER",
  "SUBORDINATE",
];

const CONFIGURED_WEIGHT_KEY: Record<
  Exclude<ScoringRelation, "SELF">,
  keyof ScoringRelationWeights
> = {
  MANAGER: "manager",
  PEER: "peer",
  SUBORDINATE: "subordinate",
};

/** 组树后的维度节点 */
interface DimensionNode {
  dimension: ScoringDimension;
  children: DimensionNode[];
  /** 直挂 RATING 题（TEXT 题 weight=null，不参与计分） */
  questions: ScoringQuestion[];
}

/** 组树 + 结构校验：最大两级、parentId 悬空、dimensionId 悬空、混合挂载 */
function buildTree(
  dimensions: ScoringDimension[],
  questions: ScoringQuestion[],
): DimensionNode[] {
  const byId = new Map<string, ScoringDimension>();
  for (const d of dimensions) {
    if (byId.has(d.id)) {
      throw new ScoringStructureError(`维度 ${d.id} 重复`);
    }
    byId.set(d.id, d);
  }

  const nodes = new Map<string, DimensionNode>();
  for (const d of dimensions) {
    nodes.set(d.id, {
      dimension: d,
      children: [],
      questions: [],
    });
  }

  const roots: DimensionNode[] = [];
  for (const d of dimensions) {
    if (d.parentId === null) {
      roots.push(nodes.get(d.id) as DimensionNode);
      continue;
    }
    const parent = byId.get(d.parentId);
    if (!parent) {
      throw new ScoringStructureError(
        `维度 ${d.id} 的父维度 ${d.parentId} 不存在`,
      );
    }
    if (parent.parentId !== null) {
      throw new ScoringStructureError(
        `维度 ${d.id} 嵌套超过两级（${parent.parentId} → ${parent.id} → ${d.id}）`,
      );
    }
    (nodes.get(parent.id) as DimensionNode).children.push(
      nodes.get(d.id) as DimensionNode,
    );
  }

  // 题目挂载（含 TEXT：结构校验不分题型；计分时只保留 RATING）
  for (const q of questions) {
    const node = nodes.get(q.dimensionId);
    if (!node) {
      throw new ScoringStructureError(
        `题目 ${q.id} 挂在不存在的维度 ${q.dimensionId}`,
      );
    }
    if (q.weight !== null) {
      node.questions.push(q);
    }
  }

  // 同一维度不能同时直接挂题目和二级维度（与问卷导入校验一致）
  for (const d of dimensions) {
    const node = nodes.get(d.id) as DimensionNode;
    if (node.children.length > 0 && dHasDirectQuestion(questions, d.id)) {
      throw new ScoringStructureError(
        `维度 ${d.id} 同时直接挂题目和二级维度，评分结构歧义`,
      );
    }
  }

  return roots;
}

/** 该维度是否直挂任何题目（含 TEXT，与维度树约束一致） */
function dHasDirectQuestion(
  questions: ScoringQuestion[],
  dimensionId: string,
): boolean {
  return questions.some((q) => q.dimensionId === dimensionId);
}

function dimensionApplicable(
  d: ScoringDimension,
  relation: ScoringRelation,
): boolean {
  return d[APPLICABLE_FIELD[relation]];
}

/** 题目对关系是否可见：未覆盖时继承维度规则（维度已在上层过滤），覆盖后按题目自身规则 */
function questionApplicable(
  q: ScoringQuestion,
  relation: ScoringRelation,
): boolean {
  return q.overrideRelationRules ? q[APPLICABLE_FIELD[relation]] : true;
}

/** 题目平均分：该关系所有有效提交中本题得分的算术平均；无分返回 null */
function averageScore(scores: Decimal[]): Decimal | null {
  if (scores.length === 0) return null;
  let sum = new Decimal(0);
  for (const s of scores) sum = sum.plus(s);
  return sum.div(scores.length);
}

/** 归一化权重：weight / total（total ≤ 0 时返回 0，防御全零权重配置） */
function normalizeWeight(weight: Decimal, total: Decimal): Decimal {
  if (total.lessThanOrEqualTo(0)) return new Decimal(0);
  return weight.div(total);
}

/**
 * 计算一个维度（一级或二级）内「直挂题目层」的得分与明细。
 * 题目权重在「可见且有平均分」的题目集合内归一化（PRD 第 32 节）。
 */
function computeQuestionLevel(
  questions: ScoringQuestion[],
  submissions: ScoringSubmission[],
  relation: ScoringRelation,
): { score: Decimal | null; details: QuestionScoreDetail[] } {
  const visible = questions.filter((q) => questionApplicable(q, relation));

  const details: QuestionScoreDetail[] = [];
  const scored: { detail: QuestionScoreDetail; weight: Decimal }[] = [];

  for (const q of visible) {
    const scores: Decimal[] = [];
    for (const s of submissions) {
      const value = s.scores[q.id];
      if (value !== undefined && value !== null) {
        scores.push(new Decimal(value));
      }
    }
    const average = averageScore(scores);
    const detail: QuestionScoreDetail = {
      questionId: q.id,
      scores,
      average,
      normalizedWeight: null,
    };
    details.push(detail);
    if (average !== null && q.weight !== null) {
      scored.push({ detail, weight: new Decimal(q.weight) });
    }
  }

  if (scored.length === 0) return { score: null, details };

  const totalWeight = scored.reduce(
    (acc, s) => acc.plus(s.weight),
    new Decimal(0),
  );
  let score = new Decimal(0);
  for (const s of scored) {
    s.detail.normalizedWeight = normalizeWeight(s.weight, totalWeight);
    score = score.plus(
      (s.detail.average as Decimal).times(s.detail.normalizedWeight),
    );
  }
  return { score, details };
}

/**
 * 计算单个关系的全部一级维度明细与关系得分。
 * - 两层问卷：一级维度得分 = Σ(题目得分 × 归一化题目权重)
 * - 三层问卷：先算二级维度（题目层），再按二级权重归一化加权
 * - 一级维度权重在「有得分」的维度集合内归一化（PRD 第 32 节）
 */
function computeRelationDetail(
  roots: DimensionNode[],
  submissions: ScoringSubmission[],
  relation: ScoringRelation,
): { score: Decimal | null; dimensions: DimensionScoreDetail[] } {
  const visibleRoots = roots.filter((r) =>
    dimensionApplicable(r.dimension, relation),
  );

  const dimensions: DimensionScoreDetail[] = [];
  const scoredDims: { detail: DimensionScoreDetail; weight: Decimal }[] = [];

  for (const root of visibleRoots) {
    const children: DimensionScoreDetail[] = [];
    let score: Decimal | null;

    if (root.children.length > 0) {
      // 三层问卷：二级维度层
      const scoredChildren: {
        detail: DimensionScoreDetail;
        weight: Decimal;
      }[] = [];
      for (const child of root.children) {
        if (!dimensionApplicable(child.dimension, relation)) continue;
        const { score: childScore, details } = computeQuestionLevel(
          child.questions,
          submissions,
          relation,
        );
        const detail: DimensionScoreDetail = {
          dimensionId: child.dimension.id,
          score: childScore,
          normalizedWeight: null,
          questions: details,
          children: [],
        };
        children.push(detail);
        if (childScore !== null) {
          scoredChildren.push({
            detail,
            weight: new Decimal(child.dimension.weight),
          });
        }
      }
      if (scoredChildren.length === 0) {
        score = null;
      } else {
        const totalWeight = scoredChildren.reduce(
          (acc, c) => acc.plus(c.weight),
          new Decimal(0),
        );
        score = new Decimal(0);
        for (const c of scoredChildren) {
          c.detail.normalizedWeight = normalizeWeight(c.weight, totalWeight);
          score = score.plus(
            (c.detail.score as Decimal).times(c.detail.normalizedWeight),
          );
        }
      }
      const detail: DimensionScoreDetail = {
        dimensionId: root.dimension.id,
        score,
        normalizedWeight: null,
        questions: [],
        children,
      };
      dimensions.push(detail);
      if (score !== null) {
        scoredDims.push({ detail, weight: new Decimal(root.dimension.weight) });
      }
    } else {
      // 两层问卷：一级维度直挂题目
      const { score: dimScore, details } = computeQuestionLevel(
        root.questions,
        submissions,
        relation,
      );
      const detail: DimensionScoreDetail = {
        dimensionId: root.dimension.id,
        score: dimScore,
        normalizedWeight: null,
        questions: details,
        children: [],
      };
      dimensions.push(detail);
      if (dimScore !== null) {
        scoredDims.push({ detail, weight: new Decimal(root.dimension.weight) });
      }
    }
  }

  if (scoredDims.length === 0) return { score: null, dimensions };

  const totalWeight = scoredDims.reduce(
    (acc, d) => acc.plus(d.weight),
    new Decimal(0),
  );
  let relationScore = new Decimal(0);
  for (const d of scoredDims) {
    d.detail.normalizedWeight = normalizeWeight(d.weight, totalWeight);
    relationScore = relationScore.plus(
      (d.detail.score as Decimal).times(d.detail.normalizedWeight),
    );
  }
  return { score: relationScore, dimensions };
}

/**
 * 计算一个被评人的完整评分（技术文档第 27~33 节）。
 *
 * 输入的 submissions 必须是当前有效版本（数据层已按 Submission.invalidatedAt
 * 为空筛选）；退回重评后旧版本不传入（技术文档第 20 节）。
 */
export function computeScores(input: ScoringInput): ScoringResult {
  const tree = buildTree(input.dimensions, input.questions);

  const byRelation = new Map<ScoringRelation, ScoringSubmission[]>();
  for (const s of input.submissions) {
    const list = byRelation.get(s.relationType);
    if (list) list.push(s);
    else byRelation.set(s.relationType, [s]);
  }

  const relations: RelationScoreDetail[] = RELATION_ORDER.map((relation) => {
    const subs = byRelation.get(relation) ?? [];
    const { score, dimensions } = computeRelationDetail(tree, subs, relation);
    return {
      relation,
      score,
      effectiveWeight: null,
      submissionCount: subs.length,
      dimensions,
    };
  });

  // 360 总分：仅有效他评关系参与（铁律 7：SELF 不入总分）
  const validRelations = relations.filter(
    (
      r,
    ): r is RelationScoreDetail & {
      relation: Exclude<ScoringRelation, "SELF">;
      score: Decimal;
    } => r.relation !== "SELF" && r.score !== null,
  );

  let total360: Decimal | null = null;
  if (validRelations.length > 0) {
    const totalConfigured = validRelations.reduce(
      (acc, r) =>
        acc.plus(new Decimal(input.weights[CONFIGURED_WEIGHT_KEY[r.relation]])),
      new Decimal(0),
    );
    if (totalConfigured.greaterThan(0)) {
      total360 = new Decimal(0);
      for (const r of validRelations) {
        const configured = new Decimal(
          input.weights[CONFIGURED_WEIGHT_KEY[r.relation]],
        );
        r.effectiveWeight = configured.div(totalConfigured);
        total360 = total360.plus(r.score.times(r.effectiveWeight));
      }
    }
  }

  const self = relations.find((r) => r.relation === "SELF");
  return {
    total360,
    selfScore: self ? self.score : null,
    relations,
  };
}
