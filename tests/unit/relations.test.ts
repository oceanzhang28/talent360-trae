import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  generateRelationTemplate,
  parseRelationsExcel,
  RELATION_TEMPLATE_HEADERS,
} from "@/modules/review-relations/excel";
import {
  checkRelations,
  parseRelationType,
  type ParsedRelationRow,
} from "@/modules/review-relations/validate";

function makeRow(
  overrides: Partial<ParsedRelationRow> = {},
): ParsedRelationRow {
  return {
    row: 2,
    revieweeEmployeeNo: "10001",
    revieweeName: "张三",
    revieweeDepartment: "商品中心",
    revieweePosition: "商品经理",
    revieweeGrade: "经理级",
    reviewerEmployeeNo: "10002",
    reviewerName: "李四",
    relationLabel: "上级",
    ...overrides,
  };
}

async function buildExcel(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("评价关系");
  sheet.addRow([...RELATION_TEMPLATE_HEADERS]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseRelationType", () => {
  it("解析 上级/平级/下级", () => {
    expect(parseRelationType("上级")).toBe("MANAGER");
    expect(parseRelationType("平级")).toBe("PEER");
    expect(parseRelationType("下级")).toBe("SUBORDINATE");
    expect(parseRelationType(" 上级 ")).toBe("MANAGER");
  });

  it("非法关系类型返回 null", () => {
    expect(parseRelationType("自评")).toBeNull();
    expect(parseRelationType("同事")).toBeNull();
    expect(parseRelationType("")).toBeNull();
  });
});

describe("checkRelations（PRD 第 18 节预检查）", () => {
  it("全部合法：valid = total，人员汇总正确", () => {
    const result = checkRelations([
      makeRow(),
      makeRow({
        row: 3,
        reviewerEmployeeNo: "10003",
        reviewerName: "王五",
        relationLabel: "平级",
      }),
      makeRow({
        row: 4,
        reviewerEmployeeNo: "10004",
        reviewerName: "赵六",
        relationLabel: "下级",
      }),
    ]);
    expect(result.total).toBe(3);
    expect(result.valid).toBe(3);
    expect(result.errors).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(result.relations).toHaveLength(3);
    // 人员：张三（被评人，完整信息）+ 李四/王五/赵六（评价人，仅工号姓名）
    const zhang = result.people.find((p) => p.employeeNo === "10001")!;
    expect(zhang.name).toBe("张三");
    expect(zhang.department).toBe("商品中心");
    expect(zhang.position).toBe("商品经理");
    expect(zhang.grade).toBe("经理级");
    const li = result.people.find((p) => p.employeeNo === "10002")!;
    expect(li.department).toBeNull();
  });

  it("工号或姓名为空 → 错误行", () => {
    const result = checkRelations([
      makeRow({ row: 2, revieweeEmployeeNo: "" }),
      makeRow({ row: 3, reviewerName: "" }),
    ]);
    expect(result.valid).toBe(0);
    expect(result.errors).toBe(2);
    expect(result.issues[0]!.message).toContain("被评人工号为空");
    expect(result.issues[1]!.message).toContain("评价人姓名为空");
  });

  it("被评人部门/岗位/职级为空 → 错误行（PRD 16.1 必填）", () => {
    const result = checkRelations([
      makeRow({ row: 2, revieweeDepartment: "" }),
      makeRow({ row: 3, revieweePosition: "" }),
      makeRow({ row: 4, revieweeGrade: "" }),
    ]);
    expect(result.errors).toBe(3);
    expect(result.issues[0]!.message).toContain("被评人部门为空");
    expect(result.issues[2]!.message).toContain("被评人职级为空");
  });

  it("非法关系类型 → 错误行", () => {
    const result = checkRelations([makeRow({ relationLabel: "同事" })]);
    expect(result.errors).toBe(1);
    expect(result.issues[0]!.message).toContain("非法关系类型");
  });

  it("工号姓名冲突 → 错误行（首行定义工号）", () => {
    const result = checkRelations([
      makeRow(),
      makeRow({ row: 3, revieweeName: "张三丰" }),
    ]);
    expect(result.valid).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.issues[0]!.message).toContain("工号姓名冲突");
    expect(result.issues[0]!.message).toContain("10001");
  });

  it("完全相同的行 → 重复", () => {
    const result = checkRelations([makeRow(), makeRow({ row: 3 })]);
    expect(result.valid).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.issues[0]!.type).toBe("duplicate");
  });

  it("同一评价人对同一被评人两种关系 → 冲突", () => {
    const result = checkRelations([
      makeRow(),
      makeRow({ row: 3, relationLabel: "平级" }),
    ]);
    expect(result.valid).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.issues[0]!.message).toContain("两种关系");
  });

  it("评价人后作为被评人出现 → 人员信息合并补全", () => {
    const result = checkRelations([
      // 李四先作为评价人（只有工号姓名）
      makeRow(),
      // 李四作为被评人（完整信息）
      makeRow({
        row: 3,
        revieweeEmployeeNo: "10002",
        revieweeName: "李四",
        revieweeDepartment: "商品中心",
        revieweePosition: "商品总监",
        revieweeGrade: "总监级",
        reviewerEmployeeNo: "10003",
        reviewerName: "王五",
        relationLabel: "平级",
      }),
    ]);
    expect(result.valid).toBe(2);
    const li = result.people.find((p) => p.employeeNo === "10002")!;
    expect(li.department).toBe("商品中心");
    expect(li.grade).toBe("总监级");
  });

  it("总数 = 有效 + 错误 + 重复 + 冲突（技术文档 48 节）", () => {
    const result = checkRelations([
      makeRow(), // valid
      makeRow({ row: 3 }), // duplicate
      makeRow({ row: 4, relationLabel: "平级" }), // conflict
      makeRow({ row: 5, revieweeEmployeeNo: "" }), // error
    ]);
    expect(result.total).toBe(4);
    expect(
      result.valid + result.errors + result.duplicates + result.conflicts,
    ).toBe(result.total);
  });
});

describe("关系 Excel 模板", () => {
  it("模板生成 → 解析 → 校验全部通过（往返一致）", async () => {
    const buffer = await generateRelationTemplate();
    const rows = await parseRelationsExcel(buffer);
    expect(rows.length).toBe(4); // 4 条示例关系
    const result = checkRelations(rows);
    expect(result.errors).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.valid).toBe(4);
    // 示例含 2 个被评人（张三、李四）
    expect(result.people.length).toBeGreaterThanOrEqual(4);
  });

  it("解析跳过空行并保留 Excel 行号", async () => {
    const buffer = await buildExcel([
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10002",
        "李四",
        "上级",
      ],
      [],
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10003",
        "王五",
        "平级",
      ],
    ]);
    const rows = await parseRelationsExcel(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.row).toBe(4);
  });
});
