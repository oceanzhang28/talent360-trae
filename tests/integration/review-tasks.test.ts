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
  getDraft,
  getTaskDetail,
  listMyTasks,
  returnTask,
  saveDraft,
  submitTask,
} from "@/modules/review-tasks/service";

/**
 * Sprint 5 集成测试：评价端单人模式全流程。
 * 覆盖：任务列表分组、按关系过滤问卷、草稿增量保存与恢复、
 * 铁律 4（HR/系统管理员/非本人拿不到草稿）、提交版本快照、lockedAt 锁定、
 * HR 退回 + 重交新版本（历史保留）、非 ACTIVE 项目只读。
 * 直连 service 层；无数据库环境自动跳过。
 */
describe.skipIf(!process.env.DATABASE_URL)("评价端单人模式（Sprint 5）", () => {
  const HR_NO = "it-s5-hr";
  const WANGWU_NO = "10003"; // 王五：张三/李四的平级评价人（模板自带）
  const LISI_NO = "10002"; // 李四：张三的上级评价人（非王五任务的评价人）
  const NAME_PREFIX = "IT-S5-";
  const HOUR = 60 * 60 * 1000;

  let hr: User;
  let wangwu: User;
  let lisi: User;
  let projectId = "";
  let peerTaskId = ""; // 王五 → 张三（平级）
  let peerTask2Id = ""; // 王五 → 李四（平级）

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
    return relation.tasks[0].id;
  }

  beforeAll(async () => {
    const ensure = (employeeNo: string, name: string) =>
      prisma.user.upsert({
        where: { employeeNo },
        update: {},
        create: { employeeNo, name, systemRole: "USER" },
      });
    [hr, wangwu, lisi] = await Promise.all([
      ensure(HR_NO, "集成测试S5HR"),
      ensure(WANGWU_NO, "王五"),
      ensure(LISI_NO, "李四"),
    ]);

    // 建项目（时间已开始）→ 导入问卷 → 导入关系（模板自带示例数据）
    const project = await createProject(hr, {
      name: `${NAME_PREFIX}评价端全流程`,
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
    // 直接置 ACTIVE（等价于 syncStatus 的惰性转换，避免依赖读取触发）
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ACTIVE" },
    });

    peerTaskId = await findTaskId(WANGWU_NO, "10001");
    peerTask2Id = await findTaskId(WANGWU_NO, "10002");
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { employeeNo: { in: [HR_NO, WANGWU_NO, LISI_NO] } },
    });
  });

  // ---------- 任务列表 ----------

  /** 王五/李四工号同时存在于 E2E 遗留项目，断言只统计本项目 */
  function tasksOf(my: Awaited<ReturnType<typeof listMyTasks>>) {
    return my.groups
      .flatMap((g) => g.tasks)
      .filter((t) => t.project.id === projectId);
  }

  it("我的任务：按关系分组 + 状态计数（平级 2 份，自评/上级/下级为空）", async () => {
    const my = await listMyTasks(wangwu);
    const mine = tasksOf(my);
    expect(mine).toHaveLength(2);
    expect(mine.every((t) => t.status === "NOT_STARTED")).toBe(true);
    expect(mine.every((t) => t.relationType === "PEER")).toBe(true);
    expect(mine.map((t) => t.reviewee.name).sort()).toEqual(["张三", "李四"]);
    for (const type of ["SELF", "MANAGER", "SUBORDINATE"] as const) {
      expect(
        my.groups
          .find((g) => g.relationType === type)!
          .tasks.filter((t) => t.project.id === projectId),
      ).toEqual([]);
    }
  });

  it("李四的任务分组：上级 1 + 自评 1", async () => {
    const my = await listMyTasks(lisi);
    expect(tasksOf(my)).toHaveLength(2);
    expect(
      my.groups
        .find((g) => g.relationType === "MANAGER")!
        .tasks.filter((t) => t.project.id === projectId),
    ).toHaveLength(1);
    expect(
      my.groups
        .find((g) => g.relationType === "SELF")!
        .tasks.filter((t) => t.project.id === projectId),
    ).toHaveLength(1);
    expect(
      my.groups
        .find((g) => g.relationType === "PEER")!
        .tasks.filter((t) => t.project.id === projectId),
    ).toHaveLength(0);
  });

  // ---------- 任务详情（按关系过滤） ----------

  it("任务详情：平级视角过滤 Q5（题目级 override 平级=否），量表 10 档", async () => {
    const detail = await getTaskDetail(peerTaskId, wangwu);
    expect(detail.reviewee.name).toBe("张三");
    expect(detail.relationType).toBe("PEER");
    expect(detail.task.editable).toBe(true);
    expect(detail.scales).toHaveLength(10);
    expect(detail.scales[0]).toMatchObject({ value: 0.5 });
    expect(detail.scales[9]).toMatchObject({ value: 5 });
    const codes = JSON.stringify(detail.dimensions);
    expect(codes).toContain("Q1");
    expect(codes).toContain("Q4");
    expect(codes).not.toContain("Q5");
    expect(detail.dimensions.map((d) => d.name)).toEqual([
      "团队管理",
      "专业能力",
    ]);
  });

  it("任务详情：上级视角包含 Q5（override 上级=是）", async () => {
    const managerTaskId = await findTaskId(LISI_NO, "10001");
    const detail = await getTaskDetail(managerTaskId, lisi);
    expect(JSON.stringify(detail.dimensions)).toContain("Q5");
  });

  // ---------- 草稿 ----------

  it("草稿增量保存：首次写入任务进入 IN_PROGRESS，读取可恢复", async () => {
    const q1 = await questionIdByCode("Q1");
    const res = await saveDraft(peerTaskId, wangwu, {
      answers: [{ questionId: q1, score: 4.5 }],
    });
    expect(res).toEqual({ saved: 1, status: "IN_PROGRESS" });

    const q2 = await questionIdByCode("Q2");
    await saveDraft(peerTaskId, wangwu, {
      answers: [{ questionId: q2, score: 3 }],
    });

    const draft = await getDraft(peerTaskId, wangwu);
    expect(draft).toHaveLength(2);
    expect(draft.find((a) => a.questionId === q1)?.score).toBe(4.5);

    const task = await prisma.reviewTask.findUnique({
      where: { id: peerTaskId },
    });
    expect(task?.status).toBe("IN_PROGRESS");
    expect(task?.startedAt).not.toBeNull();
  });

  it("草稿校验：非法分数/不适用题目/类型错配拒绝", async () => {
    const q1 = await questionIdByCode("Q1");
    const q5 = await questionIdByCode("Q5"); // 平级不适用
    await expectApiError(
      async () =>
        saveDraft(peerTaskId, wangwu, {
          answers: [{ questionId: q1, score: 3.3 }],
        }),
      400,
    );
    await expectApiError(
      async () =>
        saveDraft(peerTaskId, wangwu, {
          answers: [{ questionId: q5, textValue: "不适用" }],
        }),
      400,
    );
    await expectApiError(
      async () =>
        saveDraft(peerTaskId, wangwu, {
          answers: [{ questionId: q1, textValue: "量表题填文本" }],
        }),
      400,
    );
  });

  it("铁律 4：HR / 系统管理员 / 非本人评价人都拿不到草稿（403）", async () => {
    const admin = await prisma.user.upsert({
      where: { employeeNo: "00000" },
      update: {},
      create: {
        employeeNo: "00000",
        name: "系统管理员",
        systemRole: "SYSTEM_ADMIN",
      },
    });
    await expectApiError(async () => getDraft(peerTaskId, hr), 403);
    await expectApiError(async () => getDraft(peerTaskId, admin), 403);
    await expectApiError(async () => getDraft(peerTaskId, lisi), 403);
    await expectApiError(
      async () =>
        saveDraft(peerTaskId, hr, {
          answers: [{ questionId: await questionIdByCode("Q1"), score: 1 }],
        }),
      403,
    );
    // 任务详情同样仅评价人可见
    await expectApiError(async () => getTaskDetail(peerTaskId, hr), 403);
  });

  // ---------- 提交 ----------

  it("提交拦截：必答项不全返回缺失明细", async () => {
    const err = (await expectApiError(
      async () => submitTask(peerTaskId, wangwu),
      400,
    )) as ApiError;
    const missing = (
      err.details as { missing: Array<{ code: string }> }
    ).missing
      .map((m) => m.code)
      .sort();
    expect(missing).toEqual(["Q3", "Q4"]);
  });

  it("提交成功：v1 快照 + 任务 SUBMITTED + 问卷 lockedAt 锁定", async () => {
    const q3 = await questionIdByCode("Q3");
    const q4 = await questionIdByCode("Q4");
    await saveDraft(peerTaskId, wangwu, {
      answers: [
        { questionId: q3, score: 3.5 },
        { questionId: q4, score: 2 },
      ],
    });
    const result = await submitTask(peerTaskId, wangwu);
    expect(result).toEqual({
      taskId: peerTaskId,
      version: 1,
      status: "SUBMITTED",
    });

    const task = await prisma.reviewTask.findUnique({
      where: { id: peerTaskId },
    });
    expect(task?.status).toBe("SUBMITTED");
    expect(task?.submittedAt).not.toBeNull();
    expect(task?.currentSubmissionVersion).toBe(1);

    const submission = await prisma.submission.findUnique({
      where: { taskId_version: { taskId: peerTaskId, version: 1 } },
      include: { answers: true },
    });
    expect(submission?.invalidatedAt).toBeNull();
    expect(submission?.answers).toHaveLength(4); // Q1~Q4（平级视角不含 Q5）

    const questionnaire = await prisma.questionnaire.findUnique({
      where: { projectId },
    });
    expect(questionnaire?.lockedAt).not.toBeNull();
  });

  it("提交后草稿只读（铁律 3：HR 不能改，本人也不能改）", async () => {
    await expectApiError(
      async () =>
        saveDraft(peerTaskId, wangwu, {
          answers: [{ questionId: await questionIdByCode("Q1"), score: 5 }],
        }),
      409,
    );
    await expectApiError(async () => submitTask(peerTaskId, wangwu), 409);
  });

  // ---------- HR 退回与重交 ----------

  it("HR 退回：任务 RETURNED + 审计 + 当前 Submission 失效；重复退回 409", async () => {
    await returnTask(peerTaskId, hr);

    const task = await prisma.reviewTask.findUnique({
      where: { id: peerTaskId },
    });
    expect(task?.status).toBe("RETURNED");
    expect(task?.returnedAt).not.toBeNull();

    const v1 = await prisma.submission.findUnique({
      where: { taskId_version: { taskId: peerTaskId, version: 1 } },
    });
    expect(v1?.invalidatedAt).not.toBeNull();
    expect(v1?.invalidReason).toBe("HR退回");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "RETURN_REVIEW", entityId: peerTaskId },
    });
    expect(audit).not.toBeNull();

    await expectApiError(async () => returnTask(peerTaskId, hr), 409);
    // 非 HR 不能退回
    await expectApiError(async () => returnTask(peerTaskId, wangwu), 403);
  });

  it("重交：RETURNED 可改草稿，重新提交生成 v2，历史 v1 保留", async () => {
    const q1 = await questionIdByCode("Q1");
    const res = await saveDraft(peerTaskId, wangwu, {
      answers: [{ questionId: q1, score: 5 }],
    });
    expect(res.status).toBe("RETURNED"); // 编辑期间状态保持 RETURNED

    const result = await submitTask(peerTaskId, wangwu);
    expect(result.version).toBe(2);

    const task = await prisma.reviewTask.findUnique({
      where: { id: peerTaskId },
    });
    expect(task?.status).toBe("SUBMITTED");
    expect(task?.currentSubmissionVersion).toBe(2);

    const versions = await prisma.submission.findMany({
      where: { taskId: peerTaskId },
      orderBy: { version: "asc" },
      include: { answers: { where: { questionId: q1 } } },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].invalidatedAt).not.toBeNull(); // v1 历史保留
    expect(versions[0].invalidReason).toBe("HR退回");
    expect(versions[1].invalidatedAt).toBeNull(); // v2 当前有效
    expect(versions[1].answers[0].score?.toNumber()).toBe(5);
  });

  // ---------- 状态窗口 ----------

  it("项目 CLOSED 后：草稿与提交均被拒绝（只读窗口）", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "CLOSED" },
    });
    await expectApiError(
      async () =>
        saveDraft(peerTask2Id, wangwu, {
          answers: [{ questionId: await questionIdByCode("Q1"), score: 4 }],
        }),
      409,
    );
    await expectApiError(async () => submitTask(peerTask2Id, wangwu), 409);

    // 已提交任务在 CLOSED 下仍可被 HR 退回（需重新开放后员工才能重交）
    await returnTask(peerTaskId, hr);
    const task = await prisma.reviewTask.findUnique({
      where: { id: peerTaskId },
    });
    expect(task?.status).toBe("RETURNED");
  });
});
