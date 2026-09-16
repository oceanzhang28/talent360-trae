/**
 * 小范围真实测试 —— 数据生成 + 建项目 + Excel 导入（走真实 HTTP API，AUTH_MODE=mock）。
 * 数据规模（按 MVP-TASKS 验收建议）：5 名被评人 × 20 名评价人 × 30 量表题 + 3 开放题。
 * 用法：node scripts/real-test.mjs
 * 输出：新建项目 ID，随后可继续在 UI/API 上完成评价、退回、截止、冻结、导出。
 */
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ---- 会话：mock 登录并捕获 cookie ----
let cookie = "";
async function api(path, { method = "GET", data, multipart } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (multipart) {
    body = multipart;
  } else if (data !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(data);
  }
  const res = await fetch(BASE + path, { method, headers, body });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

// ---- 生成问卷 Excel：30 量表 + 3 开放题（16 字段） ----
const QHEAD = [
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
];

function qRow({
  l1,
  l1desc,
  l1w,
  l2,
  l2w,
  code,
  text,
  type,
  qw,
  required,
  app,
  order,
}) {
  const row = new Array(QHEAD.length).fill("");
  row[0] = l1;
  row[1] = l1desc;
  row[2] = l1w ?? "";
  row[3] = l2 ?? "";
  row[4] = l2w ?? "";
  row[5] = code;
  row[6] = text;
  row[7] = "";
  row[8] = type;
  row[9] = qw ?? "";
  row[10] = required;
  if (app) {
    row[11] = app.self;
    row[12] = app.manager;
    row[13] = app.peer;
    row[14] = app.sub;
  }
  row[15] = order;
  return row;
}

async function makeQuestionnaireExcel() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("问卷");
  sheet.addRow(QHEAD);
  let o = 1;
  const rating = (l1, l1desc, l1w, l2, l2w, n, base, label, app) => {
    const rows = [];
    // 二级维度（若有）：二级维度权重只在首题行
    for (let i = 1; i <= n; i++) {
      rows.push(
        qRow({
          l1,
          l1desc,
          l1w: i === 1 ? String(l1w) : "",
          l2,
          l2w: i === 1 && l2 !== "" ? String(l2w) : "",
          code: `${base}${String(i).padStart(2, "0")}`,
          text: `${label} —— 第${i}题`,
          type: "量表",
          qw: String(Math.round(100 / n)),
          required: "必填",
          app,
          order: o++,
        }),
      );
    }
    return rows;
  };
  const textQ = (l1, l1desc, l1w, l2, l2w, code, text, required, app) => {
    return qRow({
      l1,
      l1desc,
      l1w,
      l2,
      l2w,
      code,
      text,
      type: "文本",
      qw: "",
      required,
      app,
      order: o++,
    });
  };

  const rows = [];
  // 一级维度 团队管理 40% → 二级 团队建设50 / 人员培养50
  rows.push(
    ...rating(
      "团队管理",
      "团队组织与人员发展能力",
      40,
      "团队建设",
      50,
      5,
      "QA",
      "团队协作与氛围",
      undefined,
    ),
  );
  rows.push(
    ...rating(
      "团队管理",
      "",
      "",
      "人员培养",
      50,
      5,
      "QB",
      "人才培养与梯队",
      undefined,
    ),
  );
  // 一级维度 专业能力 35% → 二级 技术深度60 / 业务广度40
  rows.push(
    ...rating(
      "专业能力",
      "岗位相关的专业素质",
      35,
      "技术深度",
      60,
      5,
      "TC",
      "专业技能深度",
      undefined,
    ),
  );
  rows.push(
    ...rating(
      "专业能力",
      "",
      "",
      "业务广度",
      40,
      5,
      "TD",
      "跨领域业务能力",
      undefined,
    ),
  );
  // 一级维度 职业素养 25% → 直接挂 量表 + 开放题
  rows.push(
    ...rating(
      "职业素养",
      "责任心与职业道德",
      25,
      "",
      "",
      10,
      "CE",
      "职业素养",
      undefined,
    ),
  );
  // 3 个开放题：直接挂在职业素养下（都属于直接题目，不冲突）
  rows.push(
    textQ(
      "职业素养",
      "",
      "",
      "",
      "",
      "TEXT1",
      "请说明该员工最值得肯定的一个工作表现。",
      "必填",
      { self: "是", manager: "是", peer: "是", sub: "是" },
    ),
  );
  rows.push(
    textQ(
      "职业素养",
      "",
      "",
      "",
      "",
      "TEXT2",
      "请提出一条有助于该员工改进的具体建议。",
      "选填",
      { self: "是", manager: "是", peer: "是", sub: "是" },
    ),
  );
  rows.push(
    textQ(
      "职业素养",
      "",
      "",
      "",
      "",
      "TEXT3",
      "该员工是否具备你眼中的领导潜质？请说明理由。",
      "选填",
      { self: "否", manager: "是", peer: "是", sub: "是" },
    ),
  );
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- 生成关系 Excel：5 被评人 × 20 评价人（8 字段，不含自评） ----
const RHEAD = [
  "被评人工号",
  "被评人姓名",
  "被评人部门",
  "被评人岗位",
  "被评人职级",
  "评价人工号",
  "评价人姓名",
  "评价关系",
];
const REVIEWERS = Array.from({ length: 20 }, (_, i) => ({
  no: String(30001 + i),
  name: `评价人${String(i + 1).padStart(2, "0")}`,
}));
// 上级：30010 孙建军
const BOSS = { no: "30010", name: "孙建军" };
const byNo = (no) => REVIEWERS.find((r) => r.no === no) ?? BOSS;

const REVOICEES = [
  {
    no: "20001",
    name: "张伟",
    dept: "商品中心",
    pos: "商品总监",
    grade: "总监级",
  },
  {
    no: "20002",
    name: "李娜",
    dept: "技术中心",
    pos: "技术总监",
    grade: "总监级",
  },
  {
    no: "20003",
    name: "王强",
    dept: "市场中心",
    pos: "市场总监",
    grade: "总监级",
  },
  {
    no: "20004",
    name: "赵敏",
    dept: "人力中心",
    pos: "人力总监",
    grade: "总监级",
  },
  {
    no: "20005",
    name: "陈静",
    dept: "财务中心",
    pos: "财务总监",
    grade: "总监级",
  },
];
// 每个被评人：上级=孙总，平级 4，下级 6（利用旋转保证 20 名评价人基本都被用到）
const REL_PLAN = {
  20001: {
    peer: ["30001", "30002", "30003", "30004"],
    sub: ["30011", "30012", "30013", "30014", "30015", "30016"],
  },
  20002: {
    peer: ["30005", "30006", "30007", "30008"],
    sub: ["30017", "30018", "30019", "30020", "30011", "30012"],
  },
  20003: {
    peer: ["30009", "30001", "30002", "30007"],
    sub: ["30013", "30014", "30015", "30016", "30017", "30018"],
  },
  20004: {
    peer: ["30003", "30004", "30005", "30006"],
    sub: ["30019", "30020", "30011", "30012", "30013", "30014"],
  },
  20005: {
    peer: ["30007", "30008", "30009", "30001"],
    sub: ["30015", "30016", "30017", "30018", "30019", "30020"],
  },
};
// 上级唯一化（除 30010 外不重复），其它按方案
(async function () {
  const relRows = [];
  for (const rv of REVOICEES) {
    const plan = REL_PLAN[rv.no];
    // 上级
    relRows.push([
      rv.no,
      rv.name,
      rv.dept,
      rv.pos,
      rv.grade,
      BOSS.no,
      BOSS.name,
      "上级",
    ]);
    // 平级
    for (const pno of plan.peer) {
      const p = byNo(pno);
      relRows.push([
        rv.no,
        rv.name,
        rv.dept,
        rv.pos,
        rv.grade,
        p.no,
        p.name,
        "平级",
      ]);
    }
    // 下级
    for (const sno of plan.sub) {
      const s = byNo(sno);
      relRows.push([
        rv.no,
        rv.name,
        rv.dept,
        rv.pos,
        rv.grade,
        s.no,
        s.name,
        "下级",
      ]);
    }
  }
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("评价关系");
  sheet.addRow(RHEAD);
  for (const r of relRows) sheet.addRow(r);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  writeFileSync("scripts/.generated-relations.xlsx", buf);
  writeFileSync(
    "scripts/.generated-questionnaire.xlsx",
    await makeQuestionnaireExcel(),
  );

  // ---- 开始执行：HR 登录 → 建项目 → 导入问卷 → 导入关系 ----
  const HR = { employeeNo: "60000", name: "项目管理HR" };
  const projectName = `2026管理干部360测试-${Date.now()}`;

  const login = await api("/api/auth/mock/login", {
    method: "POST",
    data: { employeeNo: HR.employeeNo, name: HR.name },
  });
  if (!login.ok)
    throw new Error(
      `HR 登录失败 ${login.status}: ${JSON.stringify(login.json)}`,
    );

  const created = await api("/api/projects", {
    method: "POST",
    data: {
      name: projectName,
      startAt: new Date(Date.now() - 3600_000).toISOString(),
      endAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    },
  });
  if (!created.ok)
    throw new Error(
      `建项目失败 ${created.status}: ${JSON.stringify(created.json)}`,
    );
  const projectId = created.json.project.id;
  console.log("项目已创建:", projectId, projectName);

  // 问卷导入
  const qForm = new FormData();
  qForm.append(
    "file",
    new Blob([await makeQuestionnaireExcel()], { type: XLSX_MIME }),
    "questionnaire.xlsx",
  );
  const qImp = await api(`/api/projects/${projectId}/questionnaire/import`, {
    method: "POST",
    multipart: qForm,
  });
  if (!qImp.ok)
    throw new Error(
      `问卷导入失败 ${qImp.status}: ${JSON.stringify(qImp.json)}`,
    );
  console.log("问卷导入成功:", JSON.stringify(qImp.json));

  // 关系导入（commit 直接收文件，内部走校验）
  const rForm = new FormData();
  rForm.append(
    "file",
    new Blob([relRowsToBuf()], { type: XLSX_MIME }),
    "relations.xlsx",
  );
  const rImp = await api(`/api/projects/${projectId}/relations/import/commit`, {
    method: "POST",
    multipart: rForm,
  });
  if (!rImp.ok)
    throw new Error(
      `关系导入失败 ${rImp.status}: ${JSON.stringify(rImp.json)}`,
    );
  console.log("关系导入成功:", JSON.stringify(rImp.json));

  console.log("PROJECT_ID=" + projectId);
  console.log(
    "取数核对：应 33 道题（30量表+3文本）、5 名被评人、55 条关系（含上级）、20 名评价人",
  );
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});

import { readFileSync } from "node:fs";
function relRowsToBuf() {
  return readFileSync("scripts/.generated-relations.xlsx");
}
