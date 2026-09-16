import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { ApiError, requireSystemAdmin, withApi } from "@/lib/permissions";

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return "";
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v && v.result !== null && v.result !== undefined) {
      return String(v.result).trim();
    }
    return "";
  }
  return String(v).trim();
};

/**
 * 系统管理员：批量导入人员（人员初始化配置）。
 * 模板列（固定顺序）：工号 / 姓名 / 部门 / 岗位 / 职级；第一行为表头。
 * 已存在工号与表内重复工号记为错误并跳过（不覆盖既有用户）。
 */
export const POST = withApi(async (req) => {
  await requireSystemAdmin();

  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!file || typeof file === "string") {
    throw new ApiError(400, "请上传人员 Excel 文件");
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as never);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new ApiError(400, "Excel 中没有工作表");

  const rows: Array<{
    row: number;
    employeeNo: string;
    name: string;
    department: string;
    position: string;
    grade: string;
  }> = [];
  const errors: Array<{ row: number; message: string }> = [];

  sheet.eachRow((r, n) => {
    if (n === 1) return; // 表头
    const vals = [1, 2, 3, 4, 5].map((i) => cellText(r.getCell(i).value));
    if (vals.every((v) => v === "")) return; // 空行
    const [
      employeeNo = "",
      name = "",
      department = "",
      position = "",
      grade = "",
    ] = vals;
    if (!employeeNo || !name) {
      errors.push({ row: n, message: "工号和姓名不能为空" });
      return;
    }
    rows.push({ row: n, employeeNo, name, department, position, grade });
  });
  if (rows.length === 0 && errors.length === 0) {
    throw new ApiError(400, "Excel 中没有有效人员数据");
  }

  // 表内重复工号
  const seen = new Set<string>();
  const dedup = rows.filter((r) => {
    if (seen.has(r.employeeNo)) {
      errors.push({
        row: r.row,
        message: `工号 ${r.employeeNo} 在同一文件内重复`,
      });
      return false;
    }
    seen.add(r.employeeNo);
    return true;
  });

  // 已存在工号（不覆盖 mock 登录等既有用户）
  const existing = await prisma.user.findMany({
    where: { employeeNo: { in: dedup.map((r) => r.employeeNo) } },
    select: { employeeNo: true },
  });
  const existingSet = new Set(existing.map((e) => e.employeeNo));
  const toCreate = dedup.filter((r) => {
    if (existingSet.has(r.employeeNo)) {
      errors.push({ row: r.row, message: `工号 ${r.employeeNo} 已存在` });
      return false;
    }
    return true;
  });

  let created = 0;
  if (toCreate.length > 0) {
    await prisma.user.createMany({
      data: toCreate.map((r) => ({
        employeeNo: r.employeeNo,
        name: r.name,
        department: r.department || null,
        position: r.position || null,
        grade: r.grade || null,
      })),
    });
    created = toCreate.length;
  }

  return Response.json({ created, total: rows.length, errors });
});
