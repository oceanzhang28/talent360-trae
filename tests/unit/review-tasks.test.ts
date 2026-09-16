import { describe, expect, it } from "vitest";
import {
  filterTreeForRelation,
  findMissingRequired,
  flattenQuestions,
  validateDraftAnswers,
  DraftValidationError,
  type RawDimension,
  type TaskQuestion,
} from "@/modules/review-tasks/validate";

/** Sprint 5 单元测试：问卷按关系过滤、草稿载荷校验、提交必答校验（纯函数） */

function question(
  id: string,
  overrides: Partial<RawDimension["questions"][number]> = {},
): RawDimension["questions"][number] {
  return {
    id,
    code: `Q-${id}`,
    type: "RATING",
    title: `题目 ${id}`,
    description: null,
    required: true,
    order: 0,
    overrideRelationRules: false,
    applicableSelf: true,
    applicableManager: true,
    applicablePeer: true,
    applicableSubordinate: true,
    ...overrides,
  };
}

function dimension(
  id: string,
  overrides: Partial<RawDimension> = {},
): RawDimension {
  return {
    id,
    name: `维度 ${id}`,
    description: null,
    order: 0,
    applicableSelf: true,
    applicableManager: true,
    applicablePeer: true,
    applicableSubordinate: true,
    children: [],
    questions: [],
    ...overrides,
  };
}

describe("filterTreeForRelation：按关系过滤问卷", () => {
  const tree: RawDimension[] = [
    dimension("d1", {
      name: "全员可见",
      questions: [question("q1"), question("q2")],
      children: [
        dimension("d1-1", {
          name: "二级维度",
          applicablePeer: false,
          questions: [question("q3")],
        }),
      ],
    }),
    dimension("d2", {
      name: "仅自评",
      applicableManager: false,
      applicablePeer: false,
      applicableSubordinate: false,
      questions: [question("q4")],
    }),
    dimension("d3", {
      name: "覆盖规则",
      questions: [
        question("q5", {
          type: "TEXT",
          overrideRelationRules: true,
          applicablePeer: false,
        }),
        question("q6", { overrideRelationRules: true, applicablePeer: true }),
      ],
    }),
  ];

  it("自评：全部维度与题目可见", () => {
    const filtered = filterTreeForRelation(tree, "SELF");
    expect(filtered).toHaveLength(3);
    expect(flattenQuestions(filtered).map((q) => q.id)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
    ]);
  });

  it("平级：维度级排除 + 二级维度排除 + 题目级 override 排除", () => {
    const filtered = filterTreeForRelation(tree, "PEER");
    expect(filtered.map((d) => d.name)).toEqual(["全员可见", "覆盖规则"]);
    // d1 的二级维度 d1-1 整体被排除
    expect(filtered[0].children).toHaveLength(0);
    const codes = flattenQuestions(filtered).map((q) => q.id);
    expect(codes).toEqual(["q1", "q2", "q6"]); // q5 override 平级=否
  });

  it("上级/下级：维度级排除生效，题目继承维度规则", () => {
    const manager = filterTreeForRelation(tree, "MANAGER");
    expect(manager.map((d) => d.name)).toEqual(["全员可见", "覆盖规则"]);
    const sub = filterTreeForRelation(tree, "SUBORDINATE");
    expect(sub.map((d) => d.name)).toEqual(["全员可见", "覆盖规则"]);
  });

  it("全空问卷返回空数组", () => {
    expect(filterTreeForRelation([], "SELF")).toEqual([]);
  });
});

describe("validateDraftAnswers：草稿载荷校验", () => {
  const applicable = new Map<string, TaskQuestion>([
    [
      "r1",
      {
        id: "r1",
        code: "R1",
        type: "RATING",
        title: "量表",
        description: null,
        required: true,
      },
    ],
    [
      "t1",
      {
        id: "t1",
        code: "T1",
        type: "TEXT",
        title: "开放必填",
        description: null,
        required: true,
      },
    ],
    [
      "t2",
      {
        id: "t2",
        code: "T2",
        type: "TEXT",
        title: "开放选填",
        description: null,
        required: false,
      },
    ],
  ]);

  it("合法载荷：量表分数 + 开放文本 + 清空（null）", () => {
    const out = validateDraftAnswers(
      [
        { questionId: "r1", score: 3.5 },
        { questionId: "t1", textValue: "表现优秀" },
        { questionId: "t2", textValue: null, score: null },
      ],
      applicable,
    );
    expect(out).toEqual([
      { questionId: "r1", score: 3.5, textValue: null },
      { questionId: "t1", score: null, textValue: "表现优秀" },
      { questionId: "t2", score: null, textValue: null },
    ]);
  });

  it("空字符串文本按清空处理", () => {
    const out = validateDraftAnswers(
      [{ questionId: "t2", textValue: "" }],
      applicable,
    );
    expect(out[0].textValue).toBeNull();
  });

  it("拒绝：非数组 / 未知题目 / 重复题目", () => {
    expect(() => validateDraftAnswers({}, applicable)).toThrow(
      DraftValidationError,
    );
    expect(() =>
      validateDraftAnswers([{ questionId: "nope", score: 1 }], applicable),
    ).toThrow(/不适用/);
    expect(() =>
      validateDraftAnswers(
        [
          { questionId: "r1", score: 1 },
          { questionId: "r1", score: 2 },
        ],
        applicable,
      ),
    ).toThrow(/重复/);
  });

  it("拒绝：量表题非法分数（越界 / 非步长 / 文本）", () => {
    for (const bad of [0, 5.5, 3.3, "4"]) {
      expect(() =>
        validateDraftAnswers([{ questionId: "r1", score: bad }], applicable),
      ).toThrow(DraftValidationError);
    }
    expect(() =>
      validateDraftAnswers(
        [{ questionId: "r1", textValue: "文本" }],
        applicable,
      ),
    ).toThrow(/量表题/);
  });

  it("拒绝：开放题填分数 / 超长文本", () => {
    expect(() =>
      validateDraftAnswers([{ questionId: "t1", score: 4 }], applicable),
    ).toThrow(/开放题/);
    expect(() =>
      validateDraftAnswers(
        [{ questionId: "t1", textValue: "a".repeat(2001) }],
        applicable,
      ),
    ).toThrow(/2000/);
  });
});

describe("findMissingRequired：提交必答校验", () => {
  const questions: TaskQuestion[] = [
    {
      id: "r1",
      code: "R1",
      type: "RATING",
      title: "量表必答",
      description: null,
      required: true,
    },
    {
      id: "r2",
      code: "R2",
      type: "RATING",
      title: "量表必答2",
      description: null,
      required: true,
    },
    {
      id: "t1",
      code: "T1",
      type: "TEXT",
      title: "文本必填",
      description: null,
      required: true,
    },
    {
      id: "t2",
      code: "T2",
      type: "TEXT",
      title: "文本选填",
      description: null,
      required: false,
    },
  ];

  it("全部完成 → 无缺失", () => {
    const answers = new Map([
      ["r1", { score: 4, textValue: null }],
      ["r2", { score: 0.5, textValue: null }],
      ["t1", { score: null, textValue: "很好" }],
      ["t2", { score: null, textValue: null }],
    ]);
    expect(findMissingRequired(questions, answers)).toEqual([]);
  });

  it("缺失量表分数 / 必填文本为空或纯空格 → 报缺失；选填不检查", () => {
    const answers = new Map([
      ["r1", { score: null, textValue: null }],
      ["t1", { score: null, textValue: "   " }],
    ]);
    const missing = findMissingRequired(questions, answers);
    expect(missing.map((q) => q.id).sort()).toEqual(["r1", "r2", "t1"]);
  });

  it("无任何草稿 → 全部必答缺失", () => {
    expect(findMissingRequired(questions, new Map()).map((q) => q.id)).toEqual([
      "r1",
      "r2",
      "t1",
    ]);
  });
});
