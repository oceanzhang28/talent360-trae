import { describe, expect, it } from "vitest";
import {
  ALL_TRUE,
  moveQuestionByDrag,
  nextQuestionCode,
  numOrZero,
  questionsOf,
  reorderDimensions,
  toEditorState,
  toPayload,
  uniqueCode,
  type EditorState,
} from "@/app/projects/[id]/questionnaire/editor-model";

/**
 * 编辑器纯逻辑单测（PRD 12.1）：拖拽排序 / 跨维度移动 / 编号生成 / 入参转换。
 * 浏览器里的真实拖拽受时序影响，逻辑正确性由这里保障。
 */

function state(): EditorState {
  return {
    dims: [
      {
        key: "d1",
        parentKey: null,
        name: "团队管理",
        description: "",
        weight: "60",
        rel: { ...ALL_TRUE },
      },
      {
        key: "d2",
        parentKey: null,
        name: "专业能力",
        description: "",
        weight: "40",
        rel: { ...ALL_TRUE },
      },
      {
        key: "d3",
        parentKey: null,
        name: "空维度",
        description: "",
        weight: "0",
        rel: { ...ALL_TRUE },
      },
    ],
    questions: [
      {
        key: "q1",
        dimensionKey: "d1",
        code: "Q1",
        type: "RATING",
        title: "题一",
        description: "",
        weight: "50",
        required: true,
        override: false,
        rel: { ...ALL_TRUE },
      },
      {
        key: "q2",
        dimensionKey: "d1",
        code: "Q2",
        type: "RATING",
        title: "题二",
        description: "",
        weight: "50",
        required: true,
        override: false,
        rel: { ...ALL_TRUE },
      },
      {
        key: "q3",
        dimensionKey: "d2",
        code: "Q3",
        type: "RATING",
        title: "题三",
        description: "",
        weight: "100",
        required: true,
        override: false,
        rel: { ...ALL_TRUE },
      },
    ],
  };
}

const codesOf = (s: EditorState, dim: string) =>
  questionsOf(s, dim).map((q) => q.code);

describe("moveQuestionByDrag：同维度排序", () => {
  it("把后一题拖到前一题之前 → 顺序互换", () => {
    const next = moveQuestionByDrag(state(), "q2", {
      type: "question",
      key: "q1",
    });
    expect(next).not.toBeNull();
    expect(codesOf(next!, "d1")).toEqual(["Q2", "Q1"]);
    // 其他维度不受影响
    expect(codesOf(next!, "d2")).toEqual(["Q3"]);
  });

  it("拖到自身或结果无变化 → 返回 null（不产生多余历史与保存）", () => {
    expect(
      moveQuestionByDrag(state(), "q1", { type: "question", key: "q1" }),
    ).toBeNull();
    // q1 已经在 q2 之前，再拖到 q2 之前仍是原顺序
    expect(
      moveQuestionByDrag(state(), "q1", { type: "question", key: "q2" }),
    ).toBeNull();
  });
});

describe("moveQuestionByDrag：跨维度移动", () => {
  it("拖到另一维度的题目之前 → 归属与顺序同时更新", () => {
    const next = moveQuestionByDrag(state(), "q1", {
      type: "question",
      key: "q3",
    });
    expect(next).not.toBeNull();
    expect(codesOf(next!, "d1")).toEqual(["Q2"]);
    expect(codesOf(next!, "d2")).toEqual(["Q1", "Q3"]);
  });

  it("拖到空维度区域 → 追加为该维度唯一题目", () => {
    const next = moveQuestionByDrag(state(), "q3", {
      type: "zone",
      dimensionKey: "d3",
    });
    expect(next).not.toBeNull();
    expect(codesOf(next!, "d3")).toEqual(["Q3"]);
    expect(codesOf(next!, "d2")).toEqual([]);
  });

  it("拖到已有内容的维度区域 → 追加到该维度末尾", () => {
    const next = moveQuestionByDrag(state(), "q3", {
      type: "zone",
      dimensionKey: "d1",
    });
    expect(codesOf(next!, "d1")).toEqual(["Q1", "Q2", "Q3"]);
    expect(codesOf(next!, "d2")).toEqual([]);
  });

  it("目标维度或题目不存在 → 返回 null", () => {
    expect(
      moveQuestionByDrag(state(), "q1", { type: "question", key: "nope" }),
    ).toBeNull();
    expect(
      moveQuestionByDrag(state(), "nope", { type: "question", key: "q1" }),
    ).toBeNull();
    expect(
      moveQuestionByDrag(state(), "q1", { type: "zone", dimensionKey: "nope" }),
    ).toBeNull();
  });
});

describe("reorderDimensions：维度排序", () => {
  it("同级维度互换", () => {
    const next = reorderDimensions(state(), "d2", "d1");
    expect(next).not.toBeNull();
    expect(next!.dims.map((d) => d.name)).toEqual([
      "专业能力",
      "团队管理",
      "空维度",
    ]);
  });

  it("不同父级之间不允许移动（维度树最大两级）", () => {
    const s = state();
    s.dims.push({
      key: "c1",
      parentKey: "d1",
      name: "二级维度",
      description: "",
      weight: "100",
      rel: { ...ALL_TRUE },
    });
    expect(reorderDimensions(s, "c1", "d2")).toBeNull();
    expect(reorderDimensions(s, "d2", "c1")).toBeNull();
  });
});

describe("编号生成与入参转换", () => {
  it("nextQuestionCode 取最小可用的 Qn", () => {
    expect(nextQuestionCode(new Set())).toBe("Q1");
    expect(nextQuestionCode(new Set(["Q1", "Q2"]))).toBe("Q3");
    expect(nextQuestionCode(new Set(["Q2"]))).toBe("Q1");
  });

  it("uniqueCode 为复制出的题目生成不重复编号", () => {
    expect(uniqueCode("Q1", new Set(["Q1"]))).toBe("Q1-副本");
    expect(uniqueCode("Q1", new Set(["Q1", "Q1-副本"]))).toBe("Q1-副本2");
    expect(uniqueCode("Q9", new Set(["Q1"]))).toBe("Q9");
  });

  it("numOrZero 容忍空值/非法输入", () => {
    expect(numOrZero("")).toBe(0);
    expect(numOrZero("abc")).toBe(0);
    expect(numOrZero("60")).toBe(60);
    expect(numOrZero("-1")).toBe(0);
  });

  it("toPayload：order 取数组下标，TEXT 题权重与必答按规则归一", () => {
    const s = state();
    s.questions.push({
      key: "q4",
      dimensionKey: "d1",
      code: "Q4",
      type: "TEXT",
      title: "开放题",
      description: "",
      weight: "30",
      required: false,
      override: false,
      rel: { ...ALL_TRUE },
    });
    const payload = toPayload(s);
    expect(payload.dimensions.map((d) => d.order)).toEqual([0, 1, 2]);
    expect(
      payload.questions.map((q) => `${q.dimensionKey}:${q.code}:${q.order}`),
    ).toEqual(["d1:Q1:0", "d1:Q2:1", "d1:Q4:2", "d2:Q3:0"]);
    const text = payload.questions.find((q) => q.code === "Q4")!;
    expect(text.weight).toBeNull();
    expect(text.required).toBe(false);
    const rating = payload.questions.find((q) => q.code === "Q1")!;
    expect(rating.weight).toBe(50);
    expect(rating.required).toBe(true);
  });

  it("toEditorState：从问卷 DTO 还原维度树与题目归属，null 得到空状态", () => {
    expect(toEditorState(null)).toEqual({ dims: [], questions: [] });
    const restored = toEditorState({
      id: "x",
      lockedAt: null,
      dimensionCount: 2,
      questionCount: 1,
      dimensions: [
        {
          name: "一级",
          description: null,
          weight: 100,
          order: 0,
          applicableSelf: false,
          applicableManager: true,
          applicablePeer: true,
          applicableSubordinate: true,
          children: [],
          questions: [
            {
              code: "Q1",
              type: "RATING",
              title: "题",
              description: null,
              weight: 100,
              required: true,
              order: 0,
              overrideRelationRules: false,
              applicableSelf: true,
              applicableManager: true,
              applicablePeer: true,
              applicableSubordinate: true,
            },
          ],
        },
        {
          name: "二级容器",
          description: null,
          weight: 0,
          order: 1,
          applicableSelf: true,
          applicableManager: true,
          applicablePeer: true,
          applicableSubordinate: true,
          children: [
            {
              name: "二级",
              description: null,
              weight: 100,
              order: 0,
              applicableSelf: true,
              applicableManager: true,
              applicablePeer: true,
              applicableSubordinate: true,
              children: [],
              questions: [],
            },
          ],
          questions: [],
        },
      ],
    });
    expect(restored.dims.map((d) => d.parentKey === null)).toEqual([
      true,
      true,
      false,
    ]);
    expect(restored.dims[0]!.rel.self).toBe(false);
    expect(restored.questions.map((q) => q.code)).toEqual(["Q1"]);
    // 二级维度的题目归属指向其自身 key，而非一级维度
    const childKey = restored.dims[2]!.key;
    expect(questionsOf(restored, childKey)).toEqual([]);
  });
});
