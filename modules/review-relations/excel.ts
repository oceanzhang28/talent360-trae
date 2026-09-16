import ExcelJS from "exceljs";
import type { ParsedRelationRow } from "./validate";

/**
 * 评价关系 Excel（PRD 第 16.1 节）：一张综合表，每行一条评价关系，8 个标准字段。
 * 自评不需要 Excel 维护（项目启用自评后系统自动生成）。
 */

export const RELATION_TEMPLATE_HEADERS = [
  "被评人工号",
  "被评人姓名",
  "被评人部门",
  "被评人岗位",
  "被评人职级",
  "评价人工号",
  "评价人姓名",
  "评价关系",
] as const;

/** 生成关系导入模板（含示例数据 + 填写说明） */
export async function generateRelationTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("评价关系");

  sheet.addRow([...RELATION_TEMPLATE_HEADERS]);
  // 示例：张三被李四（上级）、王五（平级）、赵六（下级）评价；李四被王五平级评价
  const examples: (string | number)[][] = [
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
    [
      "10001",
      "张三",
      "商品中心",
      "商品经理",
      "经理级",
      "10004",
      "赵六",
      "下级",
    ],
    [
      "10002",
      "李四",
      "商品中心",
      "商品总监",
      "总监级",
      "10003",
      "王五",
      "平级",
    ],
  ];
  for (const row of examples) sheet.addRow(row);

  sheet.columns.forEach((col) => {
    col.width = 16;
  });
  sheet.getColumn(8).width = 12;

  const guide = workbook.addWorksheet("填写说明");
  const rules = [
    "1. 每行代表一条评价关系，关系始终从被评人视角定义（李四是张三的领导 → 李四评价张三 = 上级）。",
    "2. 评价关系只允许：上级 / 平级 / 下级。自评不需要填写，项目启用自评后系统自动生成。",
    "3. 工号是唯一身份键（employeeNo）：同一工号必须对应同一姓名，否则导入报错。",
    "4. 同一评价人对同一被评人在同一项目中只能有一种关系，同时出现两种会报冲突。",
    "5. 被评人的部门/岗位/职级为必填；评价人只需工号和姓名。",
    "6. 同一员工既是被评人又是评价人时，系统会自动合并为一条人员记录。",
    "7. 上传后系统先做预检查（总行数/有效/错误/重复/冲突），确认无误才会正式导入。",
    "8. 重复导入为整体替换：正式导入会清除本次导入范围外的旧关系（详见导入页面说明）。",
  ];
  rules.forEach((r) => guide.addRow([r]));
  guide.getColumn(1).width = 100;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** 解析上传的关系 Excel：跳过表头与全空行，输出原始行（未校验） */
export async function parseRelationsExcel(
  buffer: Buffer,
): Promise<ParsedRelationRow[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs 的类型定义与新版 @types/node 的 Buffer 泛型不兼容，运行时无影响
  await workbook.xlsx.load(buffer as never);

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: ParsedRelationRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 表头
    const cell = (i: number): string => {
      const v = row.getCell(i).value;
      if (v === null || v === undefined) return "";
      if (typeof v === "object" && "text" in v) return String(v.text ?? "");
      if (typeof v === "object" && "result" in v) return String(v.result ?? "");
      return String(v).trim();
    };
    const values = [
      cell(1),
      cell(2),
      cell(3),
      cell(4),
      cell(5),
      cell(6),
      cell(7),
      cell(8),
    ];
    if (values.every((v) => v === "")) return; // 空行跳过
    rows.push({
      row: rowNumber,
      revieweeEmployeeNo: values[0]!,
      revieweeName: values[1]!,
      revieweeDepartment: values[2]!,
      revieweePosition: values[3]!,
      revieweeGrade: values[4]!,
      reviewerEmployeeNo: values[5]!,
      reviewerName: values[6]!,
      relationLabel: values[7]!,
    });
  });
  return rows;
}
