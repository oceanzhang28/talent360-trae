import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import {
  closeProject,
  createProject,
  freezeProject,
} from "@/modules/projects/service";
import { importQuestionnaire } from "@/modules/questionnaires/service";
import { generateQuestionnaireTemplate } from "@/modules/questionnaires/excel";
import { commitRelationsImport } from "@/modules/review-relations/service";
import { generateRelationTemplate } from "@/modules/review-relations/excel";
import { saveDraft, submitTask } from "@/modules/review-tasks/service";
import { generateResultsExcel } from "@/modules/results/excel";

/**
 * Sprint 9 集成测试：Excel 完整导出（MVP 收尾）全链路冒烟——
 * 创建 → 问卷导入 → 关系导入 → 提交 → 冻结 → 导出。
 * 模板数据与期望值同 results.test.ts：张三(10001) 被李四上级评 4.0（含 Q5 文本）、
 * 王五平级评 5.0、自评 3.0；total = (4×40+5×30)/70 ≈ 4.43，完成率 3/4。
 * 直连 service 层；无数据库环境自动跳过。
 */
describe.skipIf(!process.env.DATABASE_URL)("Excel 完整导出（Sprint 9）", () => {
  const HR_NO = "it-s9-hr";
  const ZHANGSAN_NO = "10001";
  const LISI_NO = "10002";
  const WANGWU_NO = "10003";
  const NAME_PREFIX = "IT-S9-";
  const HOUR = 60 * 60 * 1000;

  let hr: User;
  let zhangsan: User;
  let lisi: User;
  let wangwu: User;
  let projectId = "";

  const users = new Map<string, User>();
  const userByNo = (no: string) => {
    const u = users.get(no);
    if (!u) throw new Error(`用户 ${no} 未初始化`);
    return u;
  };

  async function expectApiError(fn: () => Promise<unknown>, status: number) {
    try {
      await fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(status);
      return err as ApiError;
    }
    throw new Error(`预期抛出 ${status}，但未抛出异常`);
  }

  async function questionIdByCode(code: string): Promise<string> {
    const q = await prisma.question.findFirst({
      where: { code, dimension: { questionnaire: { projectId } } },
      select: { id: true },
    });
    if (!q) throw new Error(`题目 ${code} 不存在`);
    return q.id;
  }

  async function submitAs(
    reviewerNo: string,
    revieweeNo: string,
    ratings: Record<string, number>,
    texts: Record<string, string> = {},
  ) {
    const relation = await prisma.reviewRelation.findFirst({
      where: {
        projectId,
        reviewer: { employeeNo: reviewerNo },
        reviewee: { employeeNo: revieweeNo },
      },
      include: { tasks: { select: { id: true } } },
    });
    if (!relation || relation.tasks.length === 0) {
      throw new Error("测试任务未生成");
    }
    const taskId = relation.tasks[0].id;
    const answers: Array<
      | { questionId: string; score: number }
      | { questionId: string; textValue: string }
    > = [];
    for (const [code, score] of Object.entries(ratings)) {
      answers.push({ questionId: await questionIdByCode(code), score });
    }
    for (const [code, textValue] of Object.entries(texts)) {
      answers.push({ questionId: await questionIdByCode(code), textValue });
    }
    await saveDraft(taskId, userByNo(reviewerNo), { answers });
    await submitTask(taskId, userByNo(reviewerNo));
  }

  /** 读取 Sheet 为二维数组（跳过表头；数值/空值原样返回） */
  function rowsOf(sheet: ExcelJS.Worksheet): ExcelJS.CellValue[][] {
    const rows: ExcelJS.CellValue[][] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: ExcelJS.CellValue[] = [];
      for (let i = 1; i <= sheet.columnCount; i++) {
        values.push(row.getCell(i).value);
      }
      rows.push(values);
    });
    return rows;
  }

  let workbook: ExcelJS.Workbook;

  beforeAll(async () => {
    const ensure = (employeeNo: string, name: string) =>
      prisma.user.upsert({
        where: { employeeNo },
        update: {},
        create: { employeeNo, name, systemRole: "USER" },
      });
    [hr, zhangsan, lisi, wangwu] = await Promise.all([
      ensure(HR_NO, "集成测试S9HR"),
      ensure(ZHANGSAN_NO, "张三"),
      ensure(LISI_NO, "李四"),
      ensure(WANGWU_NO, "王五"),
    ]);
    for (const [no, u] of [
      [HR_NO, hr],
      [ZHANGSAN_NO, zhangsan],
      [LISI_NO, lisi],
      [WANGWU_NO, wangwu],
    ] as const) {
      users.set(no, u);
    }

    // 全链路：创建 → 问卷导入 → 关系导入 → 置 ACTIVE → 提交 3 份
    const project = await createProject(hr, {
      name: `${NAME_PREFIX}导出`,
      startAt: new Date(Date.now() - HOUR).toISOString(),
      endAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    });
    projectId = project.id;
    await importQuestionnaire(
      projectId,
      hr,
      await generateQuestionnaireTemplate(),
    );
    await commitRelationsImport(
      projectId,
      hr,
      await generateRelationTemplate(),
    );
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ACTIVE" },
    });

    await submitAs(ZHANGSAN_NO, ZHANGSAN_NO, {
      Q1: 3,
      Q2: 3,
      Q3: 3,
      Q4: 3,
    });
    await submitAs(
      LISI_NO,
      ZHANGSAN_NO,
      { Q1: 4, Q2: 4, Q3: 4, Q4: 4 },
      { Q5: "上级开放反馈：继续保持" },
    );
    await submitAs(WANGWU_NO, ZHANGSAN_NO, { Q1: 5, Q2: 5, Q3: 5, Q4: 5 });

    // 截止 → 冻结 → 导出
    await closeProject(projectId, hr);
    await freezeProject(projectId, hr);
    const buffer = await generateResultsExcel(projectId, hr);
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { employeeNo: { in: [HR_NO] } },
    });
  });

  it("权限与状态：非项目管理员 403；未冻结项目 409", async () => {
    await expectApiError(() => generateResultsExcel(projectId, wangwu), 403);

    // 新建一个未冻结项目（仅建项目，导出应 409）
    const draft = await createProject(hr, {
      name: `${NAME_PREFIX}未冻结`,
      startAt: new Date(Date.now() + 24 * HOUR).toISOString(),
      endAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    });
    await expectApiError(() => generateResultsExcel(draft.id, hr), 409);
  });

  it("6 个 Sheet 名称与顺序稳定（技术文档第 54 节）", () => {
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "被评人汇总",
      "评价明细",
      "题目级汇总",
      "维度级汇总",
      "任务完成情况",
      "评价关系",
    ]);
  });

  it("Sheet1 被评人汇总：张三 4.43 / 3 / 4 / 5 / 空，完成率 75%；李四全空 0/2", () => {
    const rows = rowsOf(workbook.getWorksheet("被评人汇总")!);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toEqual([
      ZHANGSAN_NO,
      "张三",
      "商品中心",
      "商品经理",
      "经理级",
      4.43, // (4×40+5×30)/70 = 4.428571 → 2 位小数
      3,
      4,
      5,
      null,
      4,
      3,
      0.75,
    ]);
    expect(rows[1]).toEqual([
      LISI_NO,
      "李四",
      "商品中心",
      "商品总监",
      "总监级",
      null,
      null,
      null,
      null,
      null,
      2,
      0,
      0,
    ]);
  });

  it("Sheet2 评价明细：13 行（4+5+4），含李四 Q5 开放题原文", () => {
    const sheet = workbook.getWorksheet("评价明细")!;
    const rows = rowsOf(sheet);
    // 张三自评 Q1~Q4（4）+ 李四上级 Q1~Q5（5，Q5 文本）+ 王五平级 Q1~Q4（4，平级不适用 Q5）
    expect(rows).toHaveLength(13);

    // 行序：被评人 → 关系（自评/上级/平级）→ 题目树序（Q1 Q2 Q3 Q4 Q5）
    const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1);
    expect(header).toEqual([
      "被评人工号",
      "被评人姓名",
      "评价人工号",
      "评价人姓名",
      "关系",
      "一级维度",
      "二级维度",
      "题目编码",
      "题目",
      "题型",
      "得分",
      "开放题原文",
    ]);

    // 张三自评第一行：Q1 团队管理 3 分
    expect(rows[0]).toEqual([
      ZHANGSAN_NO,
      "张三",
      ZHANGSAN_NO,
      "张三",
      "自评",
      "团队管理",
      "",
      "Q1",
      "能够主动识别并培养团队人才",
      "量表",
      3,
      "",
    ]);
    // Q3：一级=专业能力、二级=技术深度
    expect(rows[2]!.slice(0, 8)).toEqual([
      ZHANGSAN_NO,
      "张三",
      ZHANGSAN_NO,
      "张三",
      "自评",
      "专业能力",
      "技术深度",
      "Q3",
    ]);

    // 李四上级评张三：Q5 文本题原文
    const q5Row = rows.find((r) => r[7] === "Q5");
    expect(q5Row).toEqual([
      ZHANGSAN_NO,
      "张三",
      LISI_NO,
      "李四",
      "上级",
      "专业能力",
      "技术广度",
      "Q5",
      "请举例说明该同事最突出的专业表现",
      "文本",
      null,
      "上级开放反馈：继续保持",
    ]);

    // 王五平级评张三 Q1 = 5
    const wangwuQ1 = rows.find((r) => r[2] === WANGWU_NO && r[7] === "Q1");
    expect(wangwuQ1?.[4]).toBe("平级");
    expect(wangwuQ1?.[10]).toBe(5);
  });

  it("Sheet3 题目级汇总：张三 12 行（自评/上级/平级 × Q1~Q4），李四 0 行", () => {
    const rows = rowsOf(workbook.getWorksheet("题目级汇总")!);
    expect(rows).toHaveLength(12);

    const managerQ1 = rows.find((r) => r[2] === "上级" && r[5] === "Q1");
    expect(managerQ1).toEqual([
      ZHANGSAN_NO,
      "张三",
      "上级",
      "团队管理",
      "",
      "Q1",
      "能够主动识别并培养团队人才",
      4,
    ]);
    const peerQ3 = rows.find((r) => r[2] === "平级" && r[5] === "Q3");
    expect(peerQ3?.[3]).toBe("专业能力");
    expect(peerQ3?.[4]).toBe("技术深度");
    expect(peerQ3?.[7]).toBe(5);
    // 下级未提交 → 无快照行；Q5 文本题不进快照
    expect(rows.some((r) => r[2] === "下级")).toBe(false);
    expect(rows.some((r) => r[5] === "Q5")).toBe(false);
  });

  it("Sheet4 维度级汇总：张三 12 行（三关系 × 4 维度），树序与得分正确", () => {
    const rows = rowsOf(workbook.getWorksheet("维度级汇总")!);
    expect(rows).toHaveLength(12);

    // 自评 4 行：团队管理 → 专业能力 → 技术深度 → 技术广度（树序）
    const selfRows = rows.filter((r) => r[2] === "自评");
    expect(selfRows.map((r) => [r[3], r[4]])).toEqual([
      ["团队管理", ""],
      ["专业能力", ""],
      ["专业能力", "技术深度"],
      ["专业能力", "技术广度"],
    ]);
    expect(selfRows.every((r) => r[5] === 3)).toBe(true);

    const managerRows = rows.filter((r) => r[2] === "上级");
    expect(managerRows.every((r) => r[5] === 4)).toBe(true);
    const peerRows = rows.filter((r) => r[2] === "平级");
    expect(peerRows.every((r) => r[5] === 5)).toBe(true);
  });

  it("Sheet5 任务完成情况：6 行任务（3 已提交 / 3 未开始），含提交时间", () => {
    const rows = rowsOf(workbook.getWorksheet("任务完成情况")!);
    expect(rows).toHaveLength(6);

    const submitted = rows.filter((r) => r[5] === "已提交");
    expect(submitted).toHaveLength(3);
    // 已提交行都有提交时间（YYYY-MM-DD HH:mm）
    for (const row of submitted) {
      expect(String(row[6])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }
    const notStarted = rows.filter((r) => r[5] === "未开始");
    expect(notStarted).toHaveLength(3);
    expect(notStarted.every((r) => r[6] === "")).toBe(true);

    // 赵六下级评张三未开始
    const zhaoliu = rows.find((r) => r[2] === "10004");
    expect(zhaoliu).toMatchObject([
      ZHANGSAN_NO,
      "张三",
      "10004",
      "赵六",
      "下级",
      "未开始",
      "",
    ]);
  });

  it("Sheet6 评价关系：4 行非自评关系（与导入模板 8 字段一致）", () => {
    const sheet = workbook.getWorksheet("评价关系")!;
    const rows = rowsOf(sheet);
    expect(rows).toHaveLength(4);

    const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1);
    expect(header).toEqual([
      "被评人工号",
      "被评人姓名",
      "被评人部门",
      "被评人岗位",
      "被评人职级",
      "评价人工号",
      "评价人姓名",
      "评价关系",
    ]);

    expect(rows[0]).toEqual([
      ZHANGSAN_NO,
      "张三",
      "商品中心",
      "商品经理",
      "经理级",
      LISI_NO,
      "李四",
      "上级",
    ]);
    // 不含自评行
    expect(rows.every((r) => r[7] !== "自评")).toBe(true);
  });

  it("导出写 AuditLog（EXPORT_RESULTS）", async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { projectId, action: "EXPORT_RESULTS" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBe(hr.id);
    const metadata = JSON.parse(audit!.metadataJson ?? "{}") as {
      filename: string;
      sheets: number;
      revieweeCount: number;
    };
    expect(metadata.filename).toBe("360_results.xlsx");
    expect(metadata.sheets).toBe(6);
    expect(metadata.revieweeCount).toBe(2);
  });
});
