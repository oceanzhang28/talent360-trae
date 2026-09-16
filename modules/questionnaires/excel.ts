import ExcelJS from "exceljs";
import type { QuestionnaireData, RelationFlags } from "./validate";

/**
 * 问卷 Excel 模板与导入解析（PRD 第 12.2 节：16 个标准字段）。
 *
 * 行语义：一行 = 一道题；维度信息随题目行附带。
 * - 一级维度：每行必填；同名行视为同一维度（权重/说明以首个非空值为准，冲突报错）
 * - 二级维度：空 = 题目直接挂一级维度；同一父维度下同名视为同一二级维度
 * - 题目行"适用自评/上级/平级/下级"四个字段：全空 = 继承维度默认；全填 = 覆盖维度规则（PRD 11.2）
 */

/** PRD 12.2 的 16 个标准字段（列顺序即 Excel 列顺序） */
export const TEMPLATE_HEADERS = [
  "一级维度",
  "一级维度说明",
  "一级维度权重",
  "二级维度",
  "二级维度权重",
  "题目编号",
  "题目正文",
  "题目说明",
  "题型",
  "题目权重",
  "必填/选填",
  "适用自评",
  "适用上级",
  "适用平级",
  "适用下级",
  "排序",
] as const;

export type ParseRowError = {
  row: number;
  message: string;
};

export type ParseResult = {
  data: QuestionnaireData;
  errors: ParseRowError[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value instanceof Date) return "";
    if ("text" in value && typeof value.text === "string")
      return value.text.trim();
    if (
      "result" in value &&
      value.result !== null &&
      value.result !== undefined
    ) {
      return String(value.result).trim();
    }
    return "";
  }
  return String(value).trim();
}

function parseBool(value: string): boolean | null {
  if (["是", "true", "TRUE", "1", "y", "Y"].includes(value)) return true;
  if (["否", "false", "FALSE", "0", "n", "N", ""].includes(value)) return false;
  return null;
}

/** 解析"必填/选填"列：也兼容 是/否 */
function parseRequired(value: string): boolean | null {
  if (["必填", "是", "true", "TRUE", "1", "y", "Y"].includes(value))
    return true;
  if (["选填", "否", "false", "FALSE", "0", "n", "N", ""].includes(value))
    return false;
  return null;
}

function parseQuestionType(value: string): "RATING" | "TEXT" | null {
  if (["量表", "RATING", "rating"].includes(value)) return "RATING";
  if (["文本", "开放题", "TEXT", "text"].includes(value)) return "TEXT";
  return null;
}

/** 解析权重数字（0~100），非法返回 null */
function parseWeight(value: string): number | null {
  if (value === "") return null;
  const n = Number(value.replace("%", ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function parseFlags(
  errors: ParseRowError[],
  row: number,
  values: string[],
): RelationFlags | null {
  const parsed = values.map(parseBool);
  if (parsed.some((v) => v === null)) {
    errors.push({ row, message: "适用关系字段只能填「是」或「否」" });
    return null;
  }
  return {
    self: parsed[0]!,
    manager: parsed[1]!,
    peer: parsed[2]!,
    subordinate: parsed[3]!,
  };
}

/** 解析问卷 Excel：格式错误记入 errors；结构/权重校验由 validateQuestionnaire 负责 */
export async function parseQuestionnaireExcel(
  buffer: Buffer,
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs 的类型定义与新版 @types/node 的 Buffer 泛型不兼容，运行时无影响
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      data: { dimensions: [], questions: [] },
      errors: [{ row: 0, message: "Excel 中没有工作表" }],
    };
  }

  const errors: ParseRowError[] = [];
  // key -> 已记录的维度信息（用于冲突检测）
  const dimensionRows = new Map<
    string,
    {
      name: string;
      parentKey: string | null;
      weight: number | null;
      description: string | null;
      order: number;
    }
  >();
  const questions: QuestionnaireData["questions"] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 表头
    const cells = Array.from({ length: TEMPLATE_HEADERS.length }, (_, i) =>
      cellText(row.getCell(i + 1).value),
    );
    if (cells.every((c) => c === "")) return; // 空行

    const [
      l1Name,
      l1Desc,
      l1WeightRaw,
      l2Name,
      l2WeightRaw,
      code,
      title,
      qDesc,
      typeRaw,
      qWeightRaw,
      requiredRaw,
      selfRaw,
      managerRaw,
      peerRaw,
      subordinateRaw,
      orderRaw,
    ] = cells;

    if (!l1Name) {
      errors.push({ row: rowNumber, message: "一级维度不能为空" });
      return;
    }
    if (!code || !title) {
      errors.push({ row: rowNumber, message: "题目编号和题目正文不能为空" });
      return;
    }

    const l1Key = `L1:${l1Name}`;
    const l2Key = l2Name ? `L2:${l1Name}:${l2Name}` : null;
    const dimensionKey = l2Key ?? l1Key;

    // 一级维度登记与冲突检测
    const l1Weight = parseWeight(l1WeightRaw);
    if (l1WeightRaw !== "" && l1Weight === null) {
      errors.push({
        row: rowNumber,
        message: `一级维度权重「${l1WeightRaw}」不是 0~100 的数字`,
      });
    }
    const existingL1 = dimensionRows.get(l1Key);
    if (!existingL1) {
      dimensionRows.set(l1Key, {
        name: l1Name,
        parentKey: null,
        weight: l1Weight,
        description: l1Desc || null,
        order: dimensionRows.size,
      });
    } else {
      if (
        l1Weight !== null &&
        existingL1.weight !== null &&
        existingL1.weight !== l1Weight
      ) {
        errors.push({
          row: rowNumber,
          message: `一级维度「${l1Name}」的权重前后不一致（${existingL1.weight} / ${l1Weight}）`,
        });
      } else if (l1Weight !== null && existingL1.weight === null) {
        existingL1.weight = l1Weight;
      }
    }

    // 二级维度登记与冲突检测
    if (l2Key) {
      const l2Weight = parseWeight(l2WeightRaw);
      if (l2WeightRaw !== "" && l2Weight === null) {
        errors.push({
          row: rowNumber,
          message: `二级维度权重「${l2WeightRaw}」不是 0~100 的数字`,
        });
      }
      const existingL2 = dimensionRows.get(l2Key);
      if (!existingL2) {
        dimensionRows.set(l2Key, {
          name: l2Name,
          parentKey: l1Key,
          weight: l2Weight,
          description: null,
          order: dimensionRows.size,
        });
      } else if (
        l2Weight !== null &&
        existingL2.weight !== null &&
        existingL2.weight !== l2Weight
      ) {
        errors.push({
          row: rowNumber,
          message: `二级维度「${l2Name}」的权重前后不一致（${existingL2.weight} / ${l2Weight}）`,
        });
      } else if (l2Weight !== null && existingL2.weight === null) {
        existingL2.weight = l2Weight;
      }
    }

    // 题型
    const type = parseQuestionType(typeRaw);
    if (!type) {
      errors.push({
        row: rowNumber,
        message: `题型「${typeRaw}」无效（填「量表」或「文本」）`,
      });
      return;
    }

    // 题目权重：量表必填，文本必须为空
    const qWeight = parseWeight(qWeightRaw);
    if (type === "RATING") {
      if (qWeight === null) {
        errors.push({
          row: rowNumber,
          message: "量表题必须填写题目权重（0~100）",
        });
      }
    } else if (qWeightRaw !== "") {
      errors.push({
        row: rowNumber,
        message: "开放题（文本）不能填写题目权重",
      });
    }

    // 必填/选填：量表固定必答；文本可配置
    const required = parseRequired(requiredRaw);
    if (required === null) {
      errors.push({
        row: rowNumber,
        message: "必填/选填只能填「必填」或「选填」",
      });
      return;
    }
    if (type === "RATING" && !required) {
      errors.push({ row: rowNumber, message: "量表题必须为必填" });
      return;
    }
    // 文本选填 → required=false
    const isRequired = type === "RATING" ? true : required;

    // 适用关系：全空 = 继承维度（导入时先记录原始值，标记 override）
    const flagValues = [selfRaw, managerRaw, peerRaw, subordinateRaw];
    const allEmpty = flagValues.every((v) => v === "");
    const allFilled = flagValues.every((v) => v !== "");
    let override = false;
    let applicable: RelationFlags = {
      self: true,
      manager: true,
      peer: true,
      subordinate: true,
    };
    if (!allEmpty) {
      if (!allFilled) {
        errors.push({
          row: rowNumber,
          message: "适用关系四个字段要么全部留空（继承维度默认），要么全部填写",
        });
        return;
      }
      const flags = parseFlags(errors, rowNumber, flagValues);
      if (flags) {
        applicable = flags;
        override = true;
      }
    }

    const order = orderRaw === "" ? questions.length : Number(orderRaw);
    if (!Number.isFinite(order)) {
      errors.push({ row: rowNumber, message: `排序「${orderRaw}」不是数字` });
      return;
    }

    questions.push({
      dimensionKey,
      code,
      type,
      title,
      description: qDesc || null,
      weight: type === "TEXT" ? null : qWeight,
      required: isRequired,
      order,
      overrideRelationRules: override,
      applicable,
    });
  });

  // 维度默认适用关系：取该维度下所有题目行的首个 override？不——维度默认在 Excel 中
  // 由题目行间接表达：若维度下所有题目都未覆盖，则该维度默认全适用；HR 可在导入后于
  // 详情页调整。此处直接使用全适用默认（与 PRD 11.1 维度级配置对应，编辑能力后续补充）。
  const dimensions = Array.from(dimensionRows.entries()).map(([key, d]) => ({
    key,
    parentKey: d.parentKey,
    name: d.name,
    description: d.description,
    weight: d.weight ?? 0,
    order: d.order,
    applicable: {
      self: true,
      manager: true,
      peer: true,
      subordinate: true,
    } as RelationFlags,
  }));

  return { data: { dimensions, questions }, errors };
}

/** 生成问卷导入模板（含通过校验的示例数据 + 填写说明） */
export async function generateQuestionnaireTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("问卷");
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({
    header,
    width: Math.max(12, header.length * 2 + 4),
  }));
  sheet.getRow(1).font = { bold: true };

  // 示例数据（可通过全部校验规则）：
  // 团队管理 60%（直挂题）；专业能力 40%（二级维度）
  const examples: string[][] = [
    [
      "团队管理",
      "团队建设与人员管理能力",
      "60",
      "",
      "",
      "Q1",
      "能够主动识别并培养团队人才",
      "",
      "量表",
      "50",
      "必填",
      "",
      "",
      "",
      "",
      "1",
    ],
    [
      "团队管理",
      "",
      "",
      "",
      "",
      "Q2",
      "能够及时给予下属有效反馈",
      "",
      "量表",
      "50",
      "必填",
      "",
      "",
      "",
      "",
      "2",
    ],
    [
      "专业能力",
      "岗位相关的专业素质",
      "40",
      "技术深度",
      "60",
      "Q3",
      "掌握岗位所需的核心专业知识",
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
      "专业能力",
      "",
      "",
      "技术广度",
      "40",
      "Q4",
      "能够融会贯通跨领域知识解决问题",
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
      "专业能力",
      "",
      "",
      "技术广度",
      "",
      "Q5",
      "请举例说明该同事最突出的专业表现",
      "请具体描述",
      "文本",
      "",
      "选填",
      "是",
      "是",
      "否",
      "是",
      "2",
    ],
  ];
  for (const row of examples) {
    sheet.addRow(row);
  }

  const guide = workbook.addWorksheet("填写说明");
  guide.getColumn(1).width = 100;
  const lines = [
    "1. 一行 = 一道题；维度信息随题目行附带，不需要单独的维度行。",
    "2. 一级维度每行必填；同名行视为同一维度，权重/说明以首个非空值为准（前后不一致会报错）。",
    "3. 二级维度留空 = 题目直接挂在一级维度下；填写 = 挂在二级维度下。",
    "4. 同一个一级维度不能同时直接挂题目和二级维度（系统会校验）。",
    "5. 题型：量表（10 档评分，必答，必须填权重）或 文本（开放题，选填/必填，不能填权重）。",
    "6. 权重规则：一级维度合计 100%；同一维度下的二级维度合计 100%；同一维度下的量表题合计 100%。",
    "7. 题目行的「适用自评/上级/平级/下级」四个字段：全部留空 = 继承维度默认（全部适用）；全部填写 = 覆盖维度规则。只能填「是」或「否」。",
    "8. 题目编号在整份问卷内不能重复；排序为数字，同维度内按升序展示。",
  ];
  lines.forEach((line) => guide.addRow([line]));

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
