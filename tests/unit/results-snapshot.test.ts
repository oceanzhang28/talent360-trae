import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { toSnapshotDraft } from "@/modules/results/snapshot";
import type {
  CompletionResult,
  DimensionScoreDetail,
  QuestionScoreDetail,
  RelationScoreDetail,
  ScoringRelation,
  ScoringResult,
} from "@/modules/scoring";

/** Sprint 8 单元测试：评分结果 → 结果快照草稿的映射（无得分行剔除 + 字段提取） */

function questionDetail(
  id: string,
  average: string | null,
): QuestionScoreDetail {
  return {
    questionId: id,
    scores: [],
    average: average === null ? null : new Decimal(average),
    normalizedWeight: null,
  };
}

function dimDetail(
  id: string,
  score: string | null,
  children: DimensionScoreDetail[] = [],
  questions: QuestionScoreDetail[] = [],
): DimensionScoreDetail {
  return {
    dimensionId: id,
    score: score === null ? null : new Decimal(score),
    normalizedWeight: null,
    questions,
    children,
  };
}

function relationDetail(
  relation: ScoringRelation,
  score: string | null,
  dimensions: DimensionScoreDetail[],
): RelationScoreDetail {
  return {
    relation,
    score: score === null ? null : new Decimal(score),
    effectiveWeight: null,
    submissionCount: dimensions.length,
    dimensions,
  };
}

const completion: CompletionResult = {
  total: { expected: 4, submitted: 3, rate: new Decimal("0.75") },
  manager: { expected: 1, submitted: 1, rate: new Decimal(1) },
  peer: { expected: 2, submitted: 1, rate: new Decimal("0.5") },
  subordinate: { expected: 1, submitted: 0, rate: new Decimal(0) },
  self: { expected: 1, submitted: 1, rate: new Decimal(1), done: true },
};

const result: ScoringResult = {
  total360: new Decimal("4.428571"),
  selfScore: new Decimal(3),
  relations: [
    // 自评：一级维度有分，题目有分 + 一个无分题目（剔除）
    relationDetail("SELF", "3", [
      dimDetail(
        "d1",
        "3",
        [],
        [questionDetail("q1", "3"), questionDetail("q2", null)],
      ),
    ]),
    // 上级：两级问卷，二级维度有分；无分二级维度剔除
    relationDetail("MANAGER", "4", [
      dimDetail(
        "d2",
        "4",
        [
          dimDetail("d3", "4", [], [questionDetail("q3", "4")]),
          dimDetail("d4", null, [], [questionDetail("q4", null)]),
        ],
        [],
      ),
    ]),
    // 平级/下级：无有效提交（得分为 null，全部剔除）
    relationDetail("PEER", null, [
      dimDetail("d5", null, [], [questionDetail("q5", null)]),
    ]),
    relationDetail("SUBORDINATE", null, []),
  ],
};

describe("结果快照映射 toSnapshotDraft", () => {
  const draft = toSnapshotDraft("person-1", result, completion);

  it("提取各关系得分与 360 总分（SELF 不入总分）", () => {
    expect(draft.revieweePersonId).toBe("person-1");
    expect(draft.totalScore?.toNumber()).toBeCloseTo(4.428571, 6);
    expect(draft.selfScore?.toNumber()).toBe(3);
    expect(draft.managerScore?.toNumber()).toBe(4);
    expect(draft.peerScore).toBeNull();
    expect(draft.subordinateScore).toBeNull();
  });

  it("保存完成度（应评/实评/完成率）", () => {
    expect(draft.expectedCount).toBe(4);
    expect(draft.submittedCount).toBe(3);
    expect(draft.completionRate?.toNumber()).toBe(0.75);
  });

  it("维度行只保留有得分的（一级 + 二级，按关系标记）", () => {
    expect(draft.dimensions).toHaveLength(3);
    expect(
      draft.dimensions.map((d) => `${d.relationType}:${d.dimensionId}`),
    ).toEqual(["SELF:d1", "MANAGER:d2", "MANAGER:d3"]);
    expect(draft.dimensions[2].score.toNumber()).toBe(4);
  });

  it("题目行只保留有平均分的（无分/文本题剔除）", () => {
    expect(
      draft.questions.map((q) => `${q.relationType}:${q.questionId}`),
    ).toEqual(["SELF:q1", "MANAGER:q3"]);
    expect(draft.questions[0].score.toNumber()).toBe(3);
    expect(draft.questions[1].score.toNumber()).toBe(4);
  });
});
