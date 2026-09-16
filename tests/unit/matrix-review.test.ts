import { describe, expect, it } from "vitest";
import {
  flattenDimensionQuestions,
  type TaskDimension,
} from "@/modules/review-tasks/validate";

/** Sprint 6 单元测试：矩阵模式维度列组装（技术文档第 50 节） */

function q(id: string, code: string) {
  return {
    id,
    code,
    type: "RATING" as const,
    title: `题目 ${code}`,
    description: null,
    required: true,
  };
}

function dim(
  id: string,
  name: string,
  questions: string[][],
  children: Array<[string, string, string[][]]> = [],
): TaskDimension {
  return {
    id,
    name,
    description: null,
    children: children.map(([cid, cname, cqs]) => dim(cid, cname, cqs)),
    questions: questions.map(([qid, code]) => q(qid, code)),
  };
}

describe("flattenDimensionQuestions：矩阵维度页题目列", () => {
  it("直挂题在前，二级维度题目按序拼接（模板：团队管理 60% 直挂 + 专业能力 40% 二级）", () => {
    const d = dim(
      "d1",
      "专业能力",
      [["q1", "Q1"]],
      [
        ["c1", "专业知识", [["q2", "Q2"]]],
        [
          "c2",
          "技能",
          [
            ["q3", "Q3"],
            ["q4", "Q4"],
          ],
        ],
      ],
    );
    expect(flattenDimensionQuestions(d).map((x) => x.code)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
    ]);
  });

  it("只有直挂题", () => {
    const d = dim("d1", "团队管理", [
      ["q1", "Q1"],
      ["q2", "Q2"],
    ]);
    expect(flattenDimensionQuestions(d).map((x) => x.id)).toEqual(["q1", "q2"]);
  });

  it("只有二级维度题目", () => {
    const d = dim("d1", "专业能力", [], [["c1", "专业知识", [["q1", "Q1"]]]]);
    expect(flattenDimensionQuestions(d).map((x) => x.code)).toEqual(["Q1"]);
  });

  it("空维度返回空数组", () => {
    expect(flattenDimensionQuestions(dim("d1", "空", []))).toEqual([]);
  });
});
