import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import { createProject } from "@/modules/projects/service";
import { importQuestionnaire } from "@/modules/questionnaires/service";
import { generateQuestionnaireTemplate } from "@/modules/questionnaires/excel";
import { commitRelationsImport } from "@/modules/review-relations/service";
import { generateRelationTemplate } from "@/modules/review-relations/excel";
import {
  batchSubmitTasks,
  getMyMatrix,
  saveDraft,
} from "@/modules/review-tasks/service";

/**
 * Sprint 6 集成测试：矩阵评价模式。
 * 覆盖：矩阵数据（按关系分组/问卷过滤/草稿回填）、单人↔矩阵草稿互通、
 * 批量提交（完整提交/必答跳过/重复提交跳过/窗口跳过/权限 403/参数校验）。
 * 直连 service 层；无数据库环境自动跳过。
 */
describe.skipIf(!process.env.DATABASE_URL)("矩阵评价模式（Sprint 6）", () => {
  const HR_NO = "it-s6-hr";
  const WANGWU_NO = "10003"; // 王五：张三/李四的平级评价人（模板自带）
  const LISI_NO = "10002"; // 李四：张三的上级评价人 + 自己的自评
  const NAME_PREFIX = "IT-S6-";
  const HOUR = 60 * 60 * 1000;

  let hr: User;
  let wangwu: User;
  let projectId = "";
  let zhangsanTaskId = ""; // 王五 → 张三（平级）
  let lisiTaskId = ""; // 王五 → 李四（平级）

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

  async function findTaskId(
    reviewerNo: string,
    revieweeNo: string,
  ): Promise<string> {
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
    return relation.tasks[0]!.id;
  }

  beforeAll(async () => {
    const ensure = (employeeNo: string, name: string) =>
      prisma.user.upsert({
        where: { employeeNo },
        update: {},
        create: { employeeNo, name, systemRole: "USER" },
      });
    [hr, wangwu] = await Promise.all([
      ensure(HR_NO, "集成测试S6HR"),
      ensure(WANGWU_NO, "王五"),
      ensure(LISI_NO, "李四"),
    ]);

    const project = await createProject(hr, {
      name: `${NAME_PREFIX}矩阵评价`,
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

    zhangsanTaskId = await findTaskId(WANGWU_NO, "10001");
    lisiTaskId = await findTaskId(WANGWU_NO, "10002");
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { employeeNo: { in: [HR_NO, WANGWU_NO, LISI_NO] } },
    });
  });

  /** 王五/李四工号同时存在于 E2E 遗留项目，断言只统计本项目组 */
  function groupOf(matrix: Awaited<ReturnType<typeof getMyMatrix>>) {
    return matrix.groups.find((g) => g.project.id === projectId);
  }

  // ---------- 矩阵数据 ----------

  it("缺省 relation：自动选中第一个有任务的关系（王五只有平级任务）", async () => {
    const matrix = await getMyMatrix(wangwu);
    expect(matrix.relationType).toBe("PEER");
    expect(matrix.relationCounts.PEER).toBeGreaterThanOrEqual(2);
    expect(groupOf(matrix)!.tasks).toHaveLength(2);
  });

  it("relation 非法 → 400；relation=PEER：本项目 2 任务 + 平级视角问卷（无 Q5）+ 10 档量表", async () => {
    await expectApiError(async () => getMyMatrix(wangwu, "INVALID"), 400);

    const matrix = await getMyMatrix(wangwu, "PEER");
    const group = groupOf(matrix)!;
    expect(group.tasks.map((t) => t.reviewee.name)).toEqual(["李四", "张三"]);
    expect(group.tasks.every((t) => t.editable)).toBe(true);
    expect(group.tasks.every((t) => t.drafts.length === 0)).toBe(true);
    expect(group.scales).toHaveLength(10);
    expect(group.scales[0]).toMatchObject({ value: 0.5 });
    expect(group.scales[9]).toMatchObject({ value: 5 });
    expect(JSON.stringify(group.dimensions)).not.toContain("Q5");
    expect(group.dimensions.map((d) => d.name)).toEqual([
      "团队管理",
      "专业能力",
    ]);
  });

  it("草稿互通：单人模式写入的草稿出现在矩阵数据中（同一 DraftAnswer）", async () => {
    const q1 = await questionIdByCode("Q1");
    await saveDraft(zhangsanTaskId, wangwu, {
      answers: [{ questionId: q1, score: 4.5 }],
    });
    const matrix = await getMyMatrix(wangwu, "PEER");
    const zhangsan = groupOf(matrix)!.tasks.find(
      (t) => t.reviewee.name === "张三",
    )!;
    expect(zhangsan.drafts.find((d) => d.questionId === q1)).toMatchObject({
      score: 4.5,
    });
  });

  // ---------- 批量提交 ----------

  it("批量提交：填完整的提交成功（v1 + lockedAt），必答不全的跳过并返回缺失明细", async () => {
    // 补全张三（Q1 已在互通用例中写入 4.5）
    const q2 = await questionIdByCode("Q2");
    const q3 = await questionIdByCode("Q3");
    const q4 = await questionIdByCode("Q4");
    await saveDraft(zhangsanTaskId, wangwu, {
      answers: [
        { questionId: q2, score: 4 },
        { questionId: q3, score: 3.5 },
        { questionId: q4, score: 5 },
      ],
    });

    const result = await batchSubmitTasks(wangwu, {
      taskIds: [zhangsanTaskId, lisiTaskId],
    });
    expect(result.submitted).toEqual([
      { taskId: zhangsanTaskId, revieweeName: "张三", version: 1 },
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      taskId: lisiTaskId,
      revieweeName: "李四",
      reason: "必答项未完成，请填写后再提交",
    });
    expect(result.skipped[0]!.missing!.map((m) => m.code).sort()).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
    ]);

    const [zhangsanTask, lisiTask, questionnaire] = await Promise.all([
      prisma.reviewTask.findUnique({ where: { id: zhangsanTaskId } }),
      prisma.reviewTask.findUnique({ where: { id: lisiTaskId } }),
      prisma.questionnaire.findUnique({ where: { projectId } }),
    ]);
    expect(zhangsanTask?.status).toBe("SUBMITTED");
    expect(zhangsanTask?.currentSubmissionVersion).toBe(1);
    expect(questionnaire?.lockedAt).not.toBeNull();
    // 未填写的任务不受影响，仍可继续编辑
    expect(lisiTask?.status).toBe("NOT_STARTED");
    const matrix = await getMyMatrix(wangwu, "PEER");
    expect(
      groupOf(matrix)!.tasks.find((t) => t.reviewee.name === "张三")!.editable,
    ).toBe(false);
  });

  it("重复批量提交：已提交的跳过（不产生新版本）", async () => {
    const result = await batchSubmitTasks(wangwu, {
      taskIds: [zhangsanTaskId],
    });
    expect(result.submitted).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      taskId: zhangsanTaskId,
      reason: "已提交，无需重复提交",
    });
    const task = await prisma.reviewTask.findUnique({
      where: { id: zhangsanTaskId },
    });
    expect(task?.currentSubmissionVersion).toBe(1);
  });

  it("铁律 4 权限：批量提交中混入他人任务 → 整批 403", async () => {
    const lisiSelfTaskId = await findTaskId(LISI_NO, LISI_NO);
    await expectApiError(
      async () =>
        batchSubmitTasks(wangwu, {
          taskIds: [lisiTaskId, lisiSelfTaskId],
        }),
      403,
    );
    await expectApiError(
      async () => batchSubmitTasks(hr, { taskIds: [lisiTaskId] }),
      403,
    );
  });

  it("参数校验：空数组 / 非字符串 id / 超上限 → 400", async () => {
    await expectApiError(
      async () => batchSubmitTasks(wangwu, { taskIds: [] }),
      400,
    );
    await expectApiError(
      async () => batchSubmitTasks(wangwu, { taskIds: ["a", 123] }),
      400,
    );
    await expectApiError(
      async () =>
        batchSubmitTasks(wangwu, {
          taskIds: Array.from({ length: 101 }, (_, i) => `t${i}`),
        }),
      400,
    );
  });

  it("窗口限制：项目 CLOSED 后批量提交 → 跳过（项目不可填写）", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "CLOSED" },
    });
    const result = await batchSubmitTasks(wangwu, {
      taskIds: [lisiTaskId],
    });
    expect(result.submitted).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      taskId: lisiTaskId,
      reason: "项目当前不可填写评价（未开始或已截止）",
    });
  });
});
