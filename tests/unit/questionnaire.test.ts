import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  TEMPLATE_HEADERS,
  generateQuestionnaireTemplate,
  parseQuestionnaireExcel,
} from "@/modules/questionnaires/excel";
import {
  validateQuestionnaire,
  weightSumIs100,
  type QuestionnaireData,
  type RelationFlags,
} from "@/modules/questionnaires/validate";

const ALL: RelationFlags = {
  self: true,
  manager: true,
  peer: true,
  subordinate: true,
};

/** 合法问卷：团队管理 60% 直挂题；专业能力 40% 用二级维度 */
function validData(): QuestionnaireData {
  return {
    dimensions: [
      {
        key: "L1:团队管理",
        parentKey: null,
        name: "团队管理",
        weight: 60,
        order: 0,
        applicable: ALL,
      },
      {
        key: "L1:专业能力",
        parentKey: null,
        name: "专业能力",
        weight: 40,
        order: 1,
        applicable: ALL,
      },
      {
        key: "L2:专业能力:技术深度",
        parentKey: "L1:专业能力",
        name: "技术深度",
        weight: 60,
        order: 2,
        applicable: ALL,
      },
      {
        key: "L2:专业能力:技术广度",
        parentKey: "L1:专业能力",
        name: "技术广度",
        weight: 40,
        order: 3,
        applicable: ALL,
      },
    ],
    questions: [
      {
        dimensionKey: "L1:团队管理",
        code: "Q1",
        type: "RATING",
        title: "题1",
        weight: 50,
        required: true,
        order: 0,
        overrideRelationRules: false,
        applicable: ALL,
      },
      {
        dimensionKey: "L1:团队管理",
        code: "Q2",
        type: "RATING",
        title: "题2",
        weight: 50,
        required: true,
        order: 1,
        overrideRelationRules: false,
        applicable: ALL,
      },
      {
        dimensionKey: "L2:专业能力:技术深度",
        code: "Q3",
        type: "RATING",
        title: "题3",
        weight: 100,
        required: true,
        order: 0,
        overrideRelationRules: false,
        applicable: ALL,
      },
      {
        dimensionKey: "L2:专业能力:技术广度",
        code: "Q4",
        type: "RATING",
        title: "题4",
        weight: 100,
        required: true,
        order: 0,
        overrideRelationRules: false,
        applicable: ALL,
      },
      {
        dimensionKey: "L2:专业能力:技术广度",
        code: "Q5",
        type: "TEXT",
        title: "题5",
        weight: null,
        required: false,
        order: 1,
        overrideRelationRules: true,
        applicable: {
          self: true,
          manager: true,
          peer: false,
          subordinate: true,
        },
      },
    ],
  };
}

function messagesOf(data: QuestionnaireData): string[] {
  return validateQuestionnaire(data).map((e) => `${e.path}: ${e.message}`);
}

describe("weightSumIs100", () => {
  it("以 1% 为单位取整，浮点组合不误判", () => {
    expect(weightSumIs100([33.3, 33.3, 33.4])).toBe(true);
    expect(weightSumIs100([50, 30, 20])).toBe(true);
    expect(weightSumIs100([50, 30, 30])).toBe(false);
  });
});

describe("validateQuestionnaire：合法问卷", () => {
  it("混合结构（直挂题 + 二级维度）通过", () => {
    expect(validateQuestionnaire(validData())).toEqual([]);
  });

  it("纯直挂题结构通过", () => {
    const data = validData();
    data.dimensions = data.dimensions.filter((d) => d.name === "团队管理");
    data.dimensions[0].weight = 100;
    data.questions = data.questions.filter(
      (q) => q.dimensionKey === "L1:团队管理",
    );
    expect(validateQuestionnaire(data)).toEqual([]);
  });
});

describe("validateQuestionnaire：权重规则", () => {
  it("一级维度权重合计不等于 100% 报错", () => {
    const data = validData();
    data.dimensions[0].weight = 50;
    const msgs = messagesOf(data);
    expect(msgs.some((m) => m.includes("一级维度") && m.includes("100%"))).toBe(
      true,
    );
  });

  it("二级维度权重合计不等于 100% 报错", () => {
    const data = validData();
    data.dimensions.find((d) => d.name === "技术深度")!.weight = 50;
    const msgs = messagesOf(data);
    expect(
      msgs.some(
        (m) =>
          m.includes("专业能力") &&
          m.includes("二级维度") &&
          m.includes("100%"),
      ),
    ).toBe(true);
  });

  it("量表题权重合计不等于 100% 报错", () => {
    const data = validData();
    data.questions.find((q) => q.code === "Q1")!.weight = 40;
    const msgs = messagesOf(data);
    expect(
      msgs.some(
        (m) =>
          m.includes("团队管理") && m.includes("量表题") && m.includes("100%"),
      ),
    ).toBe(true);
  });
});

describe("validateQuestionnaire：结构规则", () => {
  it("一级维度同时直接挂题目和二级维度报错", () => {
    const data = validData();
    data.questions.push({
      dimensionKey: "L1:专业能力",
      code: "Q6",
      type: "RATING",
      title: "题6",
      weight: 100,
      required: true,
      order: 0,
      overrideRelationRules: false,
      applicable: ALL,
    });
    const msgs = messagesOf(data);
    expect(msgs.some((m) => m.includes("不能同时直接挂题目和二级维度"))).toBe(
      true,
    );
  });

  it("三级维度报错", () => {
    const data = validData();
    data.dimensions.push({
      key: "L3",
      parentKey: "L2:专业能力:技术深度",
      name: "非法三级",
      weight: 100,
      order: 9,
      applicable: ALL,
    });
    const msgs = messagesOf(data);
    expect(msgs.some((m) => m.includes("最大两级"))).toBe(true);
  });

  it("空维度（无题目）报错", () => {
    const data = validData();
    data.questions = data.questions.filter(
      (q) => q.dimensionKey !== "L1:团队管理",
    );
    const msgs = messagesOf(data);
    expect(
      msgs.some((m) => m.includes("团队管理") && m.includes("没有题目")),
    ).toBe(true);
  });

  it("只有文本题的维度报错（无量表题）", () => {
    const data = validData();
    const q4 = data.questions.find((q) => q.code === "Q4")!;
    q4.type = "TEXT";
    q4.weight = null;
    q4.required = false;
    const msgs = messagesOf(data);
    expect(
      msgs.some((m) => m.includes("技术广度") && m.includes("没有量表题")),
    ).toBe(true);
  });
});

describe("validateQuestionnaire：题目规则", () => {
  it("TEXT 带权重报错", () => {
    const data = validData();
    data.questions.find((q) => q.code === "Q5")!.weight = 10;
    expect(
      messagesOf(data).some((m) => m.includes("开放题") && m.includes("权重")),
    ).toBe(true);
  });

  it("RATING 缺权重或非必答复选报错", () => {
    const data = validData();
    data.questions.find((q) => q.code === "Q3")!.weight = null;
    data.questions.find((q) => q.code === "Q4")!.required = false;
    const msgs = messagesOf(data);
    expect(msgs.some((m) => m.includes("必须设置权重"))).toBe(true);
    expect(msgs.some((m) => m.includes("必须为必答"))).toBe(true);
  });

  it("题目编号重复报错", () => {
    const data = validData();
    data.questions.find((q) => q.code === "Q4")!.code = "Q3";
    expect(messagesOf(data).some((m) => m.includes("重复"))).toBe(true);
  });
});

// ---------- Excel 模板与解析 ----------

describe("问卷 Excel 模板", () => {
  it("模板示例数据解析后通过全部校验", async () => {
    const buffer = await generateQuestionnaireTemplate();
    const result = await parseQuestionnaireExcel(buffer);
    expect(result.errors).toEqual([]);
    expect(validateQuestionnaire(result.data)).toEqual([]);
    expect(result.data.dimensions.length).toBe(4);
    expect(result.data.questions.length).toBe(5);
  });
});

/** 用原始行数据构造 Excel buffer（第一行为表头） */
async function buildExcel(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("问卷");
  sheet.addRow([...TEMPLATE_HEADERS]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("问卷 Excel 解析", () => {
  it("缺失一级维度报行级错误", async () => {
    const buffer = await buildExcel([
      [
        "",
        "",
        "",
        "",
        "",
        "Q1",
        "题1",
        "",
        "量表",
        "100",
        "必填",
        "",
        "",
        "",
        "",
        "1",
      ],
    ]);
    const result = await parseQuestionnaireExcel(buffer);
    expect(
      result.errors.some((e) => e.message.includes("一级维度不能为空")),
    ).toBe(true);
  });

  it("TEXT 题带权重报错", async () => {
    const buffer = await buildExcel([
      [
        "维度A",
        "",
        "100",
        "",
        "",
        "Q1",
        "题1",
        "",
        "文本",
        "50",
        "选填",
        "",
        "",
        "",
        "",
        "1",
      ],
    ]);
    const result = await parseQuestionnaireExcel(buffer);
    expect(
      result.errors.some(
        (e) => e.message.includes("开放题") && e.message.includes("权重"),
      ),
    ).toBe(true);
  });

  it("同名维度权重冲突报错", async () => {
    const buffer = await buildExcel([
      [
        "维度A",
        "",
        "60",
        "",
        "",
        "Q1",
        "题1",
        "",
        "量表",
        "100",
        "必填",
        "",
        "",
        "",
        "",
        "1",
      ],
      [
        "维度A",
        "",
        "40",
        "",
        "",
        "Q2",
        "题2",
        "",
        "量表",
        "100",
        "必填",
        "",
        "",
        "",
        "",
        "1",
      ],
    ]);
    const result = await parseQuestionnaireExcel(buffer);
    expect(result.errors.some((e) => e.message.includes("前后不一致"))).toBe(
      true,
    );
  });

  it("适用关系部分填写报错（要么全空要么全填）", async () => {
    const buffer = await buildExcel([
      [
        "维度A",
        "",
        "100",
        "",
        "",
        "Q1",
        "题1",
        "",
        "量表",
        "100",
        "必填",
        "是",
        "",
        "",
        "",
        "1",
      ],
    ]);
    const result = await parseQuestionnaireExcel(buffer);
    expect(
      result.errors.some(
        (e) => e.message.includes("全部留空") || e.message.includes("全部填写"),
      ),
    ).toBe(true);
  });

  it("题目覆盖适用关系解析为 override", async () => {
    const buffer = await buildExcel([
      [
        "维度A",
        "",
        "100",
        "",
        "",
        "Q1",
        "题1",
        "",
        "量表",
        "100",
        "必填",
        "是",
        "是",
        "否",
        "否",
        "1",
      ],
    ]);
    const result = await parseQuestionnaireExcel(buffer);
    expect(result.errors).toEqual([]);
    const q = result.data.questions[0];
    expect(q.overrideRelationRules).toBe(true);
    expect(q.applicable).toEqual({
      self: true,
      manager: true,
      peer: false,
      subordinate: false,
    });
  });

  it("空行跳过、表头行忽略", async () => {
    const buffer = await buildExcel([
      [],
      [
        "维度A",
        "",
        "100",
        "",
        "",
        "Q1",
        "题1",
        "",
        "量表",
        "100",
        "必填",
        "",
        "",
        "",
        "",
        "1",
      ],
    ]);
    const result = await parseQuestionnaireExcel(buffer);
    expect(result.errors).toEqual([]);
    expect(result.data.questions.length).toBe(1);
  });
});
