/**
 * 真实测试 —— 校验导出的 360_results.xlsx 内容。
 * 用法：PROJECT_ID=... node scripts/verify-export.mjs
 * 环境变量：PROJECT_ID 必填
 * 流程：mock 登录 HR(60000) → POST /api/projects/:id/export/excel → exceljs 打开 →
 *       打印 6 个 Sheet 的行数/表头/抽查关键行，作为 MVP 交付证明。
 */
import ExcelJS from "exceljs";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID) {
  console.error("需设置 PROJECT_ID");
  process.exit(1);
}

let cookie = "";
async function api(path, { method = "GET", data } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (data !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ok: res.ok, buf };
}

function fmt(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "object" && v !== null
    ? JSON.stringify(v)
    : String(v ?? "");
}

(async () => {
  // HR 登录
  const login = await api("/api/auth/mock/login", {
    method: "POST",
    data: { employeeNo: "60000", name: "HR管理" },
  });
  if (!login.ok) throw new Error(`HR 登录失败 ${login.status}`);

  // 触发导出
  const exp = await api(`/api/projects/${PROJECT_ID}/export/excel`, {
    method: "POST",
  });
  if (!exp.ok) throw new Error(`导出失败 ${exp.status}: ${fmt(exp.buf)}`);
  console.log(`导出成功 size=${exp.buf.length} bytes (expected ~ > 3KB)`);

  // exceljs 解析
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(exp.buf);
  console.log(`\n=== 6 个 Sheet ===`);
  const names = wb.worksheets.map((s) => s.name);
  console.log(names.join(" / "));
  console.log(`sheet 数 = ${wb.worksheets.length}`);

  for (const ws of wb.worksheets) {
    const cellsOf = (row) => {
      const vals = row.values ?? [];
      return Array.from({ length: ws.columnCount }, (_, i) => fmt(vals[i + 1]));
    };
    const rows = [];
    ws.eachRow((r) => rows.push(r));
    console.log(
      `\n[${ws.name}] ${rows.length} 行（含表头） · 表头=${cellsOf(rows[0])
        .slice(0, 10)
        .join("|")}`,
    );
    if (rows.length <= 1) {
      console.log("  (仅表头，无数据)");
      continue;
    }
    // 抽查：第一数据行 + 最后一数据行
    for (const idx of [1, rows.length - 1]) {
      if (idx >= rows.length) continue;
      console.log(
        `  行${idx + 1}: ${cellsOf(rows[idx]).slice(0, 10).join(" | ")}`,
      );
    }
  }
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
