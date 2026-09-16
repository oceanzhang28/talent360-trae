import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeScores, ScoringStructureError } from "@/modules/scoring/engine";
import type {
  DimensionScoreDetail,
  RelationScoreDetail,
  ScoringDimension,
  ScoringInput,
  ScoringQuestion,
  ScoringRelation,
  ScoringRelationWeights,
  ScoringSubmission,
} from "@/modules/scoring/types";

/**
 * 评分引擎单元测试（技术文档第 27~34 节公式 / PRD 第 31、32、34 节示例数值）。
 * 覆盖技术文档第 59 节要求的全部场景，测试先行（AGENTS.md 铁律 1）。
 */

// ---------- 测试数据构造 ----------

type Applicable = Partial<
  Pick<
    ScoringDimension,
    | "applicableSelf"
    | "applicableManager"
    | "applicablePeer"
    | "applicableSubordinate"
  >
>;

function dim(
  id: string,
  weight: number,
  parent: string | null = null,
  applicable: Applicable = {},
): ScoringDimension {
  return {
    id,
    parentId: parent,
    weight,
    applicableSelf: true,
    applicableManager: true,
    applicablePeer: true,
    applicableSubordinate: true,
    ...applicable,
  };
}

function question(
  id: string,
  dimensionId: string,
  weight: number | null = 100,
  applicable: Applicable = {},
  override = false,
): ScoringQuestion {
  return {
    id,
    dimensionId,
    weight,
    overrideRelationRules: override,
    applicableSelf: true,
    applicableManager: true,
    applicablePeer: true,
    applicableSubordinate: true,
    ...applicable,
  };
}

function sub(
  relationType: ScoringRelation,
  scores: Record<string, number>,
): ScoringSubmission {
  return { relationType, scores };
}

const W_403030: ScoringRelationWeights = {
  manager: 40,
  peer: 30,
  subordinate: 30,
};

/** 两层问卷基础结构：A(40)→Q1，B(30)→Q2，C(30)→Q3（各维度单题 100%） */
function twoLevelInput(
  submissions: ScoringSubmission[],
  weights: ScoringRelationWeights = W_403030,
): ScoringInput {
  return {
    dimensions: [dim("A", 40), dim("B", 30), dim("C", 30)],
    questions: [question("Q1", "A"), question("Q2", "B"), question("Q3", "C")],
    submissions,
    weights,
  };
}

// ---------- 断言辅助 ----------

function relationOf(
  result: ReturnType<typeof computeScores>,
  relation: ScoringRelation,
): RelationScoreDetail {
  const detail = result.relations.find((r) => r.relation === relation);
  expect(detail, `缺少关系 ${relation} 明细`).toBeDefined();
  return detail as RelationScoreDetail;
}

/** 在关系明细树中查找维度（含二级） */
function dimensionOf(
  relation: RelationScoreDetail,
  dimensionId: string,
): DimensionScoreDetail | undefined {
  const walk = (
    list: DimensionScoreDetail[],
  ): DimensionScoreDetail | undefined => {
    for (const d of list) {
      if (d.dimensionId === dimensionId) return d;
      const child = walk(d.children);
      if (child) return child;
    }
    return undefined;
  };
  return walk(relation.dimensions);
}

/** Decimal 全精度比较（中间计算 20 位有效数字，容差 1e-18） */
function expectDecimal(
  actual: Decimal | null | undefined,
  expected: Decimal.Value,
  message?: string,
): void {
  expect(actual, message ?? `期望 ${expected}`).not.toBeNull();
  const diff = (actual as Decimal).sub(new Decimal(expected)).abs();
  expect(
    diff.lessThanOrEqualTo(new Decimal("1e-18")),
    `期望 ${expected}，实际 ${actual?.toString()}`,
  ).toBe(true);
}

// ---------- 1. 多评价人题目平均（PRD 31.1） ----------

describe("题目平均分", () => {
  it("3 名平级评 3.5/4.0/4.5 → 题目得分 4.00", () => {
    const result = computeScores(
      twoLevelInput([
        sub("PEER", { Q1: 3.5, Q2: 4, Q3: 4 }),
        sub("PEER", { Q1: 4, Q2: 4, Q3: 4 }),
        sub("PEER", { Q1: 4.5, Q2: 4, Q3: 4 }),
      ]),
    );
    const peer = relationOf(result, "PEER");
    const q1 = peer.dimensions[0].questions[0];
    expect(q1.scores.map((s) => s.toNumber())).toEqual([3.5, 4, 4.5]);
    expectDecimal(q1.average, 4, "PRD 31.1：题目平级得分 4.00");
  });

  it("部分评价人未提交：只对已提交者求平均", () => {
    const result = computeScores(
      twoLevelInput([
        sub("PEER", { Q1: 3.5, Q2: 4, Q3: 4 }),
        sub("PEER", { Q1: 4.5, Q2: 4, Q3: 4 }),
        // 第 3 名平级未提交，引擎输入中不存在
      ]),
    );
    const q1 = relationOf(result, "PEER").dimensions[0].questions[0];
    expect(q1.scores.length).toBe(2);
    expectDecimal(q1.average, 4);
  });

  it("某条提交缺某题分数：该题平均只计有分评价人", () => {
    const result = computeScores(
      twoLevelInput([
        sub("PEER", { Q1: 3.5, Q2: 3, Q3: 4 }),
        sub("PEER", { Q1: 4.5, Q3: 4 }), // Q2 缺分
        sub("PEER", { Q1: 4, Q3: 4 }),
      ]),
    );
    const peer = relationOf(result, "PEER");
    const q1 = peer.dimensions[0].questions[0];
    const q2 = peer.dimensions[1].questions[0];
    expect(q1.scores.length).toBe(3);
    expectDecimal(q1.average, 4);
    expect(q2.scores.length).toBe(1);
    expectDecimal(q2.average, 3);
  });
});

// ---------- 2. 正常三关系 + 40/30/30 加权（PRD 31.4 / 33） ----------

describe("正常三关系加权总分", () => {
  const result = computeScores(
    twoLevelInput([
      sub("MANAGER", { Q1: 4, Q2: 3, Q3: 5 }),
      sub("PEER", { Q1: 3, Q2: 4, Q3: 4 }),
      sub("SUBORDINATE", { Q1: 5, Q2: 5, Q3: 3 }),
    ]),
  );

  it("各关系得分 = Σ(维度得分 × 维度权重)", () => {
    // 上级：4×0.4 + 3×0.3 + 5×0.3 = 4.0
    expectDecimal(relationOf(result, "MANAGER").score, 4, "上级关系得分");
    // 平级：3×0.4 + 4×0.3 + 4×0.3 = 3.6
    expectDecimal(relationOf(result, "PEER").score, 3.6, "平级关系得分");
    // 下级：5×0.4 + 5×0.3 + 3×0.3 = 4.4
    expectDecimal(relationOf(result, "SUBORDINATE").score, 4.4, "下级关系得分");
  });

  it("关系有效权重 = 配置权重（40/30/30）", () => {
    expectDecimal(relationOf(result, "MANAGER").effectiveWeight, 0.4);
    expectDecimal(relationOf(result, "PEER").effectiveWeight, 0.3);
    expectDecimal(relationOf(result, "SUBORDINATE").effectiveWeight, 0.3);
  });

  it("360 总分 = Σ(关系得分 × 有效权重) = 4.0", () => {
    // 4.0×0.4 + 3.6×0.3 + 4.4×0.3 = 1.6 + 1.08 + 1.32 = 4.0
    expectDecimal(result.total360, 4, "PRD 33：40/30/30 加权总分");
  });

  it("提交人数统计", () => {
    expect(relationOf(result, "MANAGER").submissionCount).toBe(1);
    expect(relationOf(result, "PEER").submissionCount).toBe(1);
    expect(relationOf(result, "SUBORDINATE").submissionCount).toBe(1);
    expect(relationOf(result, "SELF").submissionCount).toBe(0);
  });
});

// ---------- 3 & 4. 缺失关系 / 0 提交归一化（PRD 34） ----------

describe("缺失关系权重归一化", () => {
  const submissions = [
    sub("MANAGER", { Q1: 4, Q2: 3, Q3: 5 }),
    sub("PEER", { Q1: 3, Q2: 4, Q3: 4 }),
  ];

  it("被评人没有下级 → 上级/平级按 40:30 归一化", () => {
    const result = computeScores(twoLevelInput(submissions));
    // 有效权重：40/70 与 30/70
    expectDecimal(
      relationOf(result, "MANAGER").effectiveWeight,
      new Decimal(40).div(70),
      "上级权重 40/70",
    );
    expectDecimal(
      relationOf(result, "PEER").effectiveWeight,
      new Decimal(30).div(70),
      "平级权重 30/70",
    );
    // 下级无得分、无有效权重
    const subOrdinate = relationOf(result, "SUBORDINATE");
    expect(subOrdinate.score).toBeNull();
    expect(subOrdinate.effectiveWeight).toBeNull();
    // 总分 = 4.0×(4/7) + 3.6×(3/7) = 26.8/7
    expectDecimal(result.total360, new Decimal("26.8").div(7), "归一化总分");
  });

  it("配置了下级但 0 提交 → 视为无有效下级数据，同样归一化", () => {
    // 引擎视角：无 SUBORDINATE 有效提交与没有下级关系行为一致（PRD 34）
    const result = computeScores(twoLevelInput(submissions));
    const subOrdinate = relationOf(result, "SUBORDINATE");
    expect(subOrdinate.submissionCount).toBe(0);
    expect(subOrdinate.score).toBeNull();
    expectDecimal(
      relationOf(result, "MANAGER").effectiveWeight,
      new Decimal(40).div(70),
    );
    expectDecimal(result.total360, new Decimal("26.8").div(7));
  });

  it("仅剩单一关系 → 权重归一化为 100%", () => {
    const result = computeScores(
      twoLevelInput([sub("MANAGER", { Q1: 4, Q2: 3, Q3: 5 })]),
    );
    expectDecimal(relationOf(result, "MANAGER").effectiveWeight, 1);
    expectDecimal(result.total360, 4, "总分即上级得分");
  });

  it("全部配置权重为 0（非法配置防御）→ 无有效权重，总分为 null", () => {
    const result = computeScores(
      twoLevelInput([sub("MANAGER", { Q1: 4, Q2: 3, Q3: 5 })], {
        manager: 0,
        peer: 0,
        subordinate: 0,
      }),
    );
    expect(result.total360).toBeNull();
    expect(relationOf(result, "MANAGER").effectiveWeight).toBeNull();
  });
});

// ---------- 5. 关系只适用部分题目 → 题目权重归一化（PRD 32，40:30 案例） ----------

describe("题目权重归一化", () => {
  it("平级只评价 A(40)、B(30)，C(30) 不适用 → 按 40:30 归一化", () => {
    const result = computeScores({
      dimensions: [dim("D", 100)],
      questions: [
        question("Q1", "D", 40),
        question("Q2", "D", 30),
        question("Q3", "D", 30, { applicablePeer: false }, true),
      ],
      submissions: [sub("PEER", { Q1: 3.5, Q2: 4 })],
      weights: W_403030,
    });
    const peer = relationOf(result, "PEER");
    const d = peer.dimensions[0];
    // Q3 对平级不可见：不出现在明细中
    expect(d.questions.map((q) => q.questionId)).toEqual(["Q1", "Q2"]);
    expectDecimal(d.questions[0].normalizedWeight, new Decimal(40).div(70));
    expectDecimal(d.questions[1].normalizedWeight, new Decimal(30).div(70));
    // 维度得分 = 3.5×(4/7) + 4×(3/7) = 26/7
    expectDecimal(d.score, new Decimal(26).div(7), "PRD 32：40:30 归一化");
    expectDecimal(peer.score, new Decimal(26).div(7));
  });

  it("维度级适用过滤：维度对关系关闭时题目整体不可见", () => {
    const result = computeScores({
      dimensions: [dim("D", 100, null, { applicablePeer: false }), dim("E", 0)],
      questions: [question("Q1", "D", 50), question("Q2", "E", 50)],
      submissions: [sub("PEER", { Q1: 4, Q2: 4.5 })],
      weights: W_403030,
    });
    const peer = relationOf(result, "PEER");
    // 维度 D 关闭 → 只剩 E，E 内题目正常计算
    expect(peer.dimensions.map((d) => d.dimensionId)).toEqual(["E"]);
    expectDecimal(peer.dimensions[0].score, 4.5);
  });

  it("可见但无分的题目不参与归一化", () => {
    const result = computeScores({
      dimensions: [dim("D", 100)],
      questions: [question("Q1", "D", 40), question("Q2", "D", 60)],
      submissions: [sub("PEER", { Q1: 3.5 })], // Q2 缺分
      weights: W_403030,
    });
    const d = relationOf(result, "PEER").dimensions[0];
    expect(d.questions[1].average).toBeNull();
    expect(d.questions[1].normalizedWeight).toBeNull();
    // Q1 权重归一化为 100%
    expectDecimal(d.questions[0].normalizedWeight, 1);
    expectDecimal(d.score, 3.5);
  });
});

// ---------- 6. 关系完全不评某维度 → 维度权重归一化（PRD 32） ----------

describe("维度权重归一化", () => {
  it("上级不评维度 C(30) → A(40)/B(30) 归一化", () => {
    const result = computeScores({
      dimensions: [
        dim("A", 40),
        dim("B", 30),
        dim("C", 30, null, { applicableManager: false }),
      ],
      questions: [
        question("Q1", "A"),
        question("Q2", "B"),
        question("Q3", "C"),
      ],
      submissions: [sub("MANAGER", { Q1: 4, Q2: 3 })],
      weights: W_403030,
    });
    const manager = relationOf(result, "MANAGER");
    // C 不可见：一级维度明细只含 A、B
    expect(manager.dimensions.map((d) => d.dimensionId)).toEqual(["A", "B"]);
    expectDecimal(
      manager.dimensions[0].normalizedWeight,
      new Decimal(40).div(70),
      "维度 A 权重 40/70",
    );
    expectDecimal(
      manager.dimensions[1].normalizedWeight,
      new Decimal(30).div(70),
      "维度 B 权重 30/70",
    );
    // 关系得分 = 4×(4/7) + 3×(3/7) = 25/7
    expectDecimal(manager.score, new Decimal(25).div(7));
    // 仅上级有效 → 总分即上级得分
    expectDecimal(result.total360, new Decimal(25).div(7));
  });
});

// ---------- 7. 两层问卷（一级维度直挂题目） ----------

describe("两层问卷", () => {
  it("一级维度得分 = Σ(题目得分 × 归一化题目权重)", () => {
    // A(40) 直挂两题 50:50；B(30)、C(30) 各一题
    const result = computeScores({
      dimensions: [dim("A", 40), dim("B", 30), dim("C", 30)],
      questions: [
        question("Q1", "A", 50),
        question("Q2", "A", 50),
        question("Q3", "B"),
        question("Q4", "C"),
      ],
      submissions: [sub("MANAGER", { Q1: 3.5, Q2: 4, Q3: 4.5, Q4: 5 })],
      weights: W_403030,
    });
    const manager = relationOf(result, "MANAGER");
    expectDecimal(manager.dimensions[0].score, 3.75, "A = (3.5+4)/2");
    expectDecimal(manager.dimensions[1].score, 4.5);
    expectDecimal(manager.dimensions[2].score, 5);
    // 关系得分 = 3.75×0.4 + 4.5×0.3 + 5×0.3 = 4.35
    expectDecimal(manager.score, 4.35);
    expectDecimal(result.total360, 4.35);
  });
});

// ---------- 8. 三层问卷（PRD 31.3） ----------

describe("三层问卷", () => {
  const result = computeScores({
    dimensions: [
      dim("A", 60),
      dim("A1", 60, "A"),
      dim("A2", 40, "A"),
      dim("B", 40),
    ],
    questions: [
      question("Q1", "A1", 50),
      question("Q2", "A1", 50),
      question("Q3", "A2"),
      question("Q4", "B"),
    ],
    submissions: [sub("MANAGER", { Q1: 3.5, Q2: 4, Q3: 4.5, Q4: 5 })],
    weights: W_403030,
  });

  it("二级维度得分 = Σ(题目得分 × 归一化题目权重)", () => {
    const manager = relationOf(result, "MANAGER");
    const a1 = dimensionOf(manager, "A1");
    const a2 = dimensionOf(manager, "A2");
    expectDecimal(a1?.score ?? null, 3.75, "A1 = 3.5×0.5 + 4×0.5");
    expectDecimal(a2?.score ?? null, 4.5, "A2 = 4.5");
  });

  it("一级维度得分 = Σ(二级维度得分 × 归一化二级权重)", () => {
    const manager = relationOf(result, "MANAGER");
    const a = dimensionOf(manager, "A");
    // A = 3.75×0.6 + 4.5×0.4 = 4.05
    expectDecimal(a?.score ?? null, 4.05, "PRD 31.3：二级维度加权");
    expectDecimal(manager.dimensions[1].score, 5, "B 直挂题");
  });

  it("关系得分 = Σ(一级维度得分 × 一级维度权重)", () => {
    // 4.05×0.6 + 5×0.4 = 4.43
    expectDecimal(
      relationOf(result, "MANAGER").score,
      4.43,
      "三层问卷关系得分",
    );
  });

  it("关系不评某个二级维度 → 二级权重归一化", () => {
    const r = computeScores({
      dimensions: [
        dim("A", 100),
        dim("A1", 60, "A"),
        dim("A2", 40, "A", { applicablePeer: false }),
      ],
      questions: [question("Q1", "A1"), question("Q2", "A2")],
      submissions: [sub("PEER", { Q1: 4.5 })],
      weights: W_403030,
    });
    const peer = relationOf(r, "PEER");
    const a = dimensionOf(peer, "A");
    const a1 = dimensionOf(peer, "A1");
    expectDecimal(a1?.normalizedWeight ?? null, 1, "A2 不可见 → A1 归一化为 1");
    expectDecimal(a?.score ?? null, 4.5, "A = A1 得分");
    expectDecimal(peer.score, 4.5);
  });
});

// ---------- 9 & 10. 自评（铁律 7 / PRD 33.1） ----------

describe("自评不入总分", () => {
  it("自评得分单独输出，不参与 360 总分与关系权重", () => {
    const result = computeScores(
      twoLevelInput([
        sub("SELF", { Q1: 2, Q2: 2, Q3: 2 }),
        sub("MANAGER", { Q1: 4, Q2: 3, Q3: 5 }),
      ]),
    );
    expectDecimal(result.selfScore, 2, "自评综合得分");
    // 上级唯一有效关系 → 总分即上级得分（自评权重不参与）
    expectDecimal(result.total360, 4, "自评不影响总分");
    expect(relationOf(result, "SELF").effectiveWeight).toBeNull();
    expectDecimal(relationOf(result, "MANAGER").effectiveWeight, 1);
  });

  it("自评可评价与上级不同的题目范围（维度级过滤）", () => {
    const result = computeScores({
      dimensions: [dim("A", 100), dim("B", 0, null, { applicableSelf: false })],
      questions: [question("Q1", "A"), question("Q2", "B")],
      submissions: [sub("SELF", { Q1: 3.5, Q2: 5 })],
      weights: W_403030,
    });
    const self = relationOf(result, "SELF");
    expect(self.dimensions.map((d) => d.dimensionId)).toEqual(["A"]);
    expectDecimal(result.selfScore, 3.5);
  });

  it("未自评 → selfScore = null，不影响他评总分", () => {
    const result = computeScores(
      twoLevelInput([sub("MANAGER", { Q1: 4, Q2: 3, Q3: 5 })]),
    );
    expect(result.selfScore).toBeNull();
    expectDecimal(result.total360, 4);
  });
});

// ---------- 11. 退回重评后使用当前有效版本（技术文档第 20 节） ----------

describe("退回重评后的有效版本", () => {
  it("只按当前有效版本（invalidatedAt=null）计分，旧版本不参与", () => {
    // 模拟数据层：任务历史两个版本，v1 已因退回失效
    const history = [
      {
        version: 1,
        invalidatedAt: "2026-09-10T10:00:00Z",
        scores: { Q1: 3, Q2: 3, Q3: 3 },
      },
      {
        version: 2,
        invalidatedAt: null,
        scores: { Q1: 4.5, Q2: 4.5, Q3: 4.5 },
      },
    ];
    // 数据层筛选：仅传入 invalidatedAt 为空的当前有效版本
    const valid = history
      .filter((s) => s.invalidatedAt === null)
      .map((s) => sub("PEER", s.scores));
    expect(valid.length).toBe(1);

    const result = computeScores(twoLevelInput(valid));
    const q1 = relationOf(result, "PEER").dimensions[0].questions[0];
    expect(q1.scores.length).toBe(1);
    expectDecimal(q1.average, 4.5, "按重评后版本计分（而非 (3+4.5)/2）");
    expectDecimal(relationOf(result, "PEER").score, 4.5);
  });
});

// ---------- 12. 无有效数据 ----------

describe("无有效提交", () => {
  it("全部关系 0 提交 → total360 与 selfScore 均为 null", () => {
    const result = computeScores(twoLevelInput([]));
    expect(result.total360).toBeNull();
    expect(result.selfScore).toBeNull();
    for (const r of result.relations) {
      expect(r.score).toBeNull();
      expect(r.effectiveWeight).toBeNull();
      expect(r.submissionCount).toBe(0);
    }
  });

  it("仅自评提交 → 总分为 null（自评不入总分）", () => {
    const result = computeScores(
      twoLevelInput([sub("SELF", { Q1: 4, Q2: 4, Q3: 4 })]),
    );
    expect(result.total360).toBeNull();
    expectDecimal(result.selfScore, 4);
  });
});

// ---------- 13. TEXT 题与权重防御 ----------

describe("题型与权重防御", () => {
  it("TEXT 题（weight=null）不参与计分与归一化", () => {
    const result = computeScores({
      dimensions: [dim("D", 100)],
      questions: [
        question("Q1", "D", 40),
        question("Q2", "D", 60),
        question("T1", "D", null), // 开放题
      ],
      submissions: [sub("PEER", { Q1: 3.5, Q2: 4 })],
      weights: W_403030,
    });
    const d = relationOf(result, "PEER").dimensions[0];
    expect(d.questions.map((q) => q.questionId)).toEqual(["Q1", "Q2"]);
    expectDecimal(d.score, 3.5 * 0.4 + 4 * 0.6);
  });
});

// ---------- 14. 结构防御（非法问卷结构 fail fast） ----------

describe("问卷结构防御", () => {
  it("一级维度同时直挂题目和二级维度 → 抛错", () => {
    expect(() =>
      computeScores({
        dimensions: [dim("A", 100), dim("A1", 100, "A")],
        questions: [question("Q1", "A"), question("Q2", "A1")],
        submissions: [],
        weights: W_403030,
      }),
    ).toThrow(ScoringStructureError);
  });

  it("维度嵌套超过两级 → 抛错", () => {
    expect(() =>
      computeScores({
        dimensions: [dim("A", 100), dim("A1", 100, "A"), dim("A1x", 100, "A1")],
        questions: [],
        submissions: [],
        weights: W_403030,
      }),
    ).toThrow(ScoringStructureError);
  });

  it("题目挂在不存在的维度上 → 抛错", () => {
    expect(() =>
      computeScores({
        dimensions: [dim("A", 100)],
        questions: [question("Q1", "GHOST")],
        submissions: [],
        weights: W_403030,
      }),
    ).toThrow(ScoringStructureError);
  });

  it("维度 id 重复 → 抛错", () => {
    expect(() =>
      computeScores({
        dimensions: [dim("A", 100), dim("A", 100)],
        questions: [],
        submissions: [],
        weights: W_403030,
      }),
    ).toThrow(ScoringStructureError);
  });

  it("维度 parentId 指向不存在的维度 → 抛错", () => {
    expect(() =>
      computeScores({
        dimensions: [dim("A", 100, "GHOST")],
        questions: [],
        submissions: [],
        weights: W_403030,
      }),
    ).toThrow(ScoringStructureError);
  });
});
