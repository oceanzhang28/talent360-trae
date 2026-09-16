import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import {
  closeProject,
  createProject,
  freezeProject,
  unfreezeProject,
} from "@/modules/projects/service";
import { importQuestionnaire } from "@/modules/questionnaires/service";
import { generateQuestionnaireTemplate } from "@/modules/questionnaires/excel";
import { commitRelationsImport } from "@/modules/review-relations/service";
import { generateRelationTemplate } from "@/modules/review-relations/excel";
import { saveDraft, submitTask } from "@/modules/review-tasks/service";
import {
  getProjectProgress,
  getResultDetail,
  listProjectResults,
  listReviewerDetails,
} from "@/modules/results/service";

/**
 * Sprint 8 集成测试：进度看板 + 冻结快照 + 结果后台 + 不可变性 + 解冻。
 * 模板数据：张三(10001) 被 李四上级/王五平级/赵六下级 评价 + 自评；
 * 李四(10002) 被 王五平级 评价 + 自评 → 共 6 任务。
 * 提交 3 份（张三自评 3.0 / 李四上级评张三 4.0 / 王五平级评张三 5.0），
 * 期望：张三 total360=(4×40+5×30)/70、完成率 3/4；李四全 null、0/2。
 * 直连 service 层；无数据库环境自动跳过。
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "进度看板与结果冻结（Sprint 8）",
  () => {
    const HR_NO = "it-s8-hr";
    const ZHANGSAN_NO = "10001";
    const LISI_NO = "10002";
    const WANGWU_NO = "10003";
    const NAME_PREFIX = "IT-S8-";
    const HOUR = 60 * 60 * 1000;

    let hr: User;
    let zhangsan: User;
    let lisi: User;
    let wangwu: User;
    let projectId = "";
    let zhangsanPersonId = "";

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

    /** 以 reviewer 身份提交对 reviewee 的评价（量表分 + 可选文本） */
    async function submitAs(
      reviewerNo: string,
      revieweeNo: string,
      ratings: Record<string, number>,
      texts: Record<string, string> = {},
    ) {
      const taskId = await findTaskId(reviewerNo, revieweeNo);
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

    beforeAll(async () => {
      const ensure = (employeeNo: string, name: string) =>
        prisma.user.upsert({
          where: { employeeNo },
          update: {},
          create: { employeeNo, name, systemRole: "USER" },
        });
      [hr, zhangsan, lisi, wangwu] = await Promise.all([
        ensure(HR_NO, "集成测试S8HR"),
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

      // 建项目（时间已开始）→ 导入问卷/关系（模板自带示例数据）→ 置 ACTIVE
      const project = await createProject(hr, {
        name: `${NAME_PREFIX}进度与结果`,
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

      // 提交 3 份：张三自评全 3.0；李四上级评张三全 4.0 + Q5 文本；王五平级评张三全 5.0
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
    });

    afterAll(async () => {
      await prisma.project.deleteMany({
        where: { name: { startsWith: NAME_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { employeeNo: { in: [HR_NO] } },
      });
    });

    // ---------- 进度看板（PRD 第 30 节） ----------

    it("项目总体进度：应评 6 / 已完成 3 / 完成率 50%", async () => {
      const progress = await getProjectProgress(projectId, hr);
      expect(progress.project.status).toBe("ACTIVE");
      expect(progress.overall).toMatchObject({
        expected: 6,
        submitted: 3,
        rate: 0.5,
      });
    });

    it("分关系进度：上级 1/1、平级 1/2、下级 0/1、自评 1/2", async () => {
      const { relations } = await getProjectProgress(projectId, hr);
      expect(relations.manager).toMatchObject({
        expected: 1,
        submitted: 1,
        rate: 1,
      });
      expect(relations.peer).toMatchObject({
        expected: 2,
        submitted: 1,
        rate: 0.5,
      });
      expect(relations.subordinate).toMatchObject({
        expected: 1,
        submitted: 0,
        rate: 0,
      });
      expect(relations.self).toMatchObject({
        expected: 2,
        submitted: 1,
        rate: 0.5,
      });
      expect(relations.self.done).toBe(true);
    });

    it("按被评人进度：张三 3/4（自评✓）、李四 0/2（自评✗）", async () => {
      const { byReviewee } = await getProjectProgress(projectId, hr);
      expect(byReviewee.map((r) => r.employeeNo)).toEqual([
        ZHANGSAN_NO,
        LISI_NO,
      ]);
      const zs = byReviewee[0]!;
      expect(zs.name).toBe("张三");
      expect(zs.self).toEqual({ done: true });
      expect(zs.manager).toMatchObject({ expected: 1, submitted: 1 });
      expect(zs.peer).toMatchObject({ expected: 1, submitted: 1 });
      expect(zs.subordinate).toMatchObject({ expected: 1, submitted: 0 });
      expect(zs.total).toMatchObject({ expected: 4, submitted: 3, rate: 0.75 });
      zhangsanPersonId = zs.personId;

      const ls = byReviewee[1]!;
      expect(ls.self).toEqual({ done: false });
      expect(ls.peer).toMatchObject({ expected: 1, submitted: 0 });
      expect(ls.total).toMatchObject({ expected: 2, submitted: 0, rate: 0 });
    });

    it("按评价人进度（催办）：张三 1/1、李四 1/2、王五 1/2、赵六 0/1 剩 1", async () => {
      const { byReviewer } = await getProjectProgress(projectId, hr);
      const byNo = new Map(byReviewer.map((r) => [r.employeeNo, r]));
      expect(byNo.get(ZHANGSAN_NO)).toMatchObject({
        name: "张三",
        total: { expected: 1, submitted: 1 },
        remaining: 0,
      });
      expect(byNo.get(LISI_NO)).toMatchObject({
        name: "李四",
        total: { expected: 2, submitted: 1 },
        remaining: 1,
      });
      expect(byNo.get(WANGWU_NO)).toMatchObject({
        name: "王五",
        total: { expected: 2, submitted: 1 },
        remaining: 1,
      });
      expect(byNo.get("10004")).toMatchObject({
        name: "赵六",
        total: { expected: 1, submitted: 0 },
        remaining: 1,
      });
    });

    it("进度权限：非项目管理员（普通评价人）403", async () => {
      await expectApiError(() => getProjectProgress(projectId, wangwu), 403);
    });

    // ---------- 冻结前置校验 ----------

    it("未冻结：结果列表实时计分（frozen=false，仅统计已提交）；实名明细可查", async () => {
      const results = await listProjectResults(projectId, hr);
      expect(results.frozen).toBe(false);
      expect(results.frozenAt).toBeNull();
      // 已提交的 3 份立即体现：张三 total=(4×40+5×30)/70，李四无提交全空
      expect(results.reviewees).toHaveLength(2);
      const zs = results.reviewees[0]!;
      expect(zs.employeeNo).toBe(ZHANGSAN_NO);
      expect(zs.selfScore).toBeCloseTo(3, 6);
      expect(zs.managerScore).toBeCloseTo(4, 6);
      expect(zs.peerScore).toBeCloseTo(5, 6);
      expect(zs.subordinateScore).toBeNull();
      expect(zs.totalScore).toBeCloseTo(310 / 70, 5);
      expect(zs.submittedCount).toBe(3);
      expect(zs.expectedCount).toBe(4);
      const ls = results.reviewees[1]!;
      expect(ls.employeeNo).toBe(LISI_NO);
      expect(ls.totalScore).toBeNull();
      expect(ls.submittedCount).toBe(0);

      // 实时下钻与实名明细在未冻结时同样可读（不再 409）
      const detail = await getResultDetail(projectId, zs.personId, hr);
      expect(detail.frozen).toBe(false);
      expect(detail.relations.length).toBeGreaterThan(0);

      const reviewers = await listReviewerDetails(
        projectId,
        zhangsanPersonId,
        hr,
      );
      expect(reviewers.reviewee.employeeNo).toBe(ZHANGSAN_NO);
      expect(reviewers.reviewers.length).toBeGreaterThan(0);
    });

    it("非 CLOSED 项目冻结 409", async () => {
      await expectApiError(() => freezeProject(projectId, hr), 409);
    });

    // ---------- 冻结（技术文档第 35 节） ----------

    it("冻结成功：CLOSED → FROZEN，生成快照 + 审计（标记完整性不足）", async () => {
      await closeProject(projectId, hr);
      const frozen = await freezeProject(projectId, hr);
      expect(frozen.status).toBe("FROZEN");
      expect(frozen.frozenAt).not.toBeNull();

      // 审计：FREEZE_PROJECT + incomplete=true（3/6 未完成仍允许冻结）
      const audit = await prisma.auditLog.findFirst({
        where: { projectId, action: "FREEZE_PROJECT" },
      });
      expect(audit).not.toBeNull();
      const metadata = JSON.parse(audit!.metadataJson ?? "{}") as {
        snapshotCount: number;
        expected: number;
        submitted: number;
        incomplete: boolean;
      };
      expect(metadata.snapshotCount).toBe(2);
      expect(metadata.expected).toBe(6);
      expect(metadata.submitted).toBe(3);
      expect(metadata.incomplete).toBe(true);

      const snapshotCount = await prisma.resultSnapshot.count({
        where: { projectId },
      });
      expect(snapshotCount).toBe(2);
    });

    it("结果列表：张三总分 (4×40+5×30)/70、李四无得分，完成率 3/4 与 0/2", async () => {
      const results = await listProjectResults(projectId, hr);
      expect(results.frozen).toBe(true);
      expect(results.frozenAt).not.toBeNull();
      expect(results.overall).toMatchObject({
        expected: 6,
        submitted: 3,
        rate: 0.5,
      });

      expect(results.reviewees.map((r) => r.employeeNo)).toEqual([
        ZHANGSAN_NO,
        LISI_NO,
      ]);
      const zs = results.reviewees[0]!;
      // 下级未评 → 有效权重 40/70、30/70：total = (4×40 + 5×30)/70
      expect(zs.totalScore).toBeCloseTo(310 / 70, 5);
      expect(zs.selfScore).toBeCloseTo(3, 6);
      expect(zs.managerScore).toBeCloseTo(4, 6);
      expect(zs.peerScore).toBeCloseTo(5, 6);
      expect(zs.subordinateScore).toBeNull();
      expect(zs.expectedCount).toBe(4);
      expect(zs.submittedCount).toBe(3);
      expect(zs.completionRate).toBeCloseTo(0.75, 6);

      const ls = results.reviewees[1]!;
      expect(ls.totalScore).toBeNull();
      expect(ls.selfScore).toBeNull();
      expect(ls.managerScore).toBeNull();
      expect(ls.peerScore).toBeNull();
      expect(ls.expectedCount).toBe(2);
      expect(ls.submittedCount).toBe(0);
      expect(ls.completionRate).toBeCloseTo(0, 6);
    });

    it("结果下钻：维度树 + 题目得分；Q5 文本题与无分关系处理正确", async () => {
      const detail = await getResultDetail(projectId, zhangsanPersonId, hr);
      expect(detail.frozen).toBe(true);
      expect(detail.reviewee.name).toBe("张三");
      expect(detail.relations.map((r) => r.relation)).toEqual([
        "SELF",
        "MANAGER",
        "PEER",
        "SUBORDINATE",
      ]);

      const self = detail.relations[0]!;
      expect(self.score).toBeCloseTo(3, 6);
      const serialized = JSON.stringify(detail.relations);
      expect(serialized).not.toContain("Q5"); // 文本题不进量表得分树

      // 自评：团队管理（直挂 Q1/Q2）3 分、专业能力 3 分 + 二级维度
      const [selfTeam, selfPro] = self.dimensions;
      expect(selfTeam.name).toBe("团队管理");
      expect(selfTeam.score).toBeCloseTo(3, 6);
      expect(selfTeam.questions.map((q) => q.code)).toEqual(["Q1", "Q2"]);
      expect(selfTeam.questions[0]!.score).toBeCloseTo(3, 6);
      expect(selfPro.name).toBe("专业能力");
      expect(selfPro.children.map((c) => c.name)).toEqual([
        "技术深度",
        "技术广度",
      ]);
      expect(selfPro.children[0]!.questions[0]!.code).toBe("Q3");
      expect(selfPro.children[1]!.questions[0]!.code).toBe("Q4");

      // 上级 4 分 / 平级 5 分（题目全部可见且得分一致）
      expect(detail.relations[1]!.score).toBeCloseTo(4, 6);
      expect(detail.relations[2]!.score).toBeCloseTo(5, 6);
      expect(
        detail.relations[2]!.dimensions[0]!.questions[0]!.score,
      ).toBeCloseTo(5, 6);

      // 下级无提交：关系与维度得分均 null（结构仍按问卷展示）
      const subordinate = detail.relations[3]!;
      expect(subordinate.score).toBeNull();
      expect(subordinate.dimensions[0]!.score).toBeNull();
      expect(subordinate.dimensions[0]!.questions[0]!.score).toBeNull();
    });

    it("评价人实名明细：3 位已提交评价人（自评/上级/平级），含开放题原文", async () => {
      const details = await listReviewerDetails(
        projectId,
        zhangsanPersonId,
        hr,
      );
      expect(details.reviewee.name).toBe("张三");
      expect(details.reviewers.map((r) => r.relationType)).toEqual([
        "SELF",
        "MANAGER",
        "PEER",
      ]);

      const [self, manager, peer] = details.reviewers;
      expect(self.reviewer.name).toBe("张三");
      expect(self.answers.find((a) => a.code === "Q1")?.score).toBeCloseTo(
        3,
        6,
      );

      expect(manager.reviewer.name).toBe("李四");
      const q5 = manager.answers.find((a) => a.code === "Q5");
      expect(q5?.type).toBe("TEXT");
      expect(q5?.textValue).toBe("上级开放反馈：继续保持");

      expect(peer.reviewer.name).toBe("王五");
      expect(peer.answers.find((a) => a.code === "Q1")?.score).toBeCloseTo(
        5,
        6,
      );
      expect(peer.answers.find((a) => a.code === "Q5")).toBeUndefined(); // 平级不适用

      // 普通评价人无权查看实名明细
      await expectApiError(
        () => listReviewerDetails(projectId, zhangsanPersonId, wangwu),
        403,
      );
    });

    it("不可变性：直改业务表 SubmissionAnswer，冻结结果不变", async () => {
      // 把李四评张三的 Q1 原始答案从 4 改成 1（绕过所有业务入口）
      const q1 = await questionIdByCode("Q1");
      const managerTask = await prisma.reviewTask.findFirst({
        where: {
          relation: {
            projectId,
            relationType: "MANAGER",
            reviewer: { employeeNo: LISI_NO },
            reviewee: { employeeNo: ZHANGSAN_NO },
          },
        },
        include: { submissions: { where: { invalidatedAt: null } } },
      });
      expect(managerTask).not.toBeNull();
      await prisma.submissionAnswer.updateMany({
        where: {
          submissionId: managerTask!.submissions[0]!.id,
          questionId: q1,
        },
        data: { score: 1 },
      });

      const results = await listProjectResults(projectId, hr);
      expect(results.reviewees[0]!.managerScore).toBeCloseTo(4, 6); // 仍是快照值
      const detail = await getResultDetail(projectId, zhangsanPersonId, hr);
      const managerDim = detail.relations[1]!.dimensions[0]!;
      expect(managerDim.questions[0]!.score).toBeCloseTo(4, 6);
    });

    // ---------- 解冻（仅系统管理员，PRD 6.3） ----------

    it("解冻权限：HR 403；系统管理员解冻成功并删除全部快照", async () => {
      await expectApiError(() => unfreezeProject(projectId, hr), 403);

      const admin = await prisma.user.upsert({
        where: { employeeNo: "00000" },
        update: {},
        create: {
          employeeNo: "00000",
          name: "系统管理员",
          systemRole: "SYSTEM_ADMIN",
        },
      });
      const reopened = await unfreezeProject(projectId, admin);
      expect(reopened.status).toBe("CLOSED");
      expect(reopened.frozenAt).toBeNull();

      expect(await prisma.resultSnapshot.count({ where: { projectId } })).toBe(
        0,
      );
      const audit = await prisma.auditLog.findFirst({
        where: { projectId, action: "UNFREEZE_PROJECT" },
      });
      expect(audit?.actorUserId).toBe(admin.id);

      // 解冻后结果列表回到未冻结态
      const results = await listProjectResults(projectId, hr);
      expect(results.frozen).toBe(false);
    });

    it("重新冻结整体重算：被改过的 Q1=1 生效（managerScore 3.1、total 274/70）", async () => {
      const refrozen = await freezeProject(projectId, hr);
      expect(refrozen.status).toBe("FROZEN");

      const results = await listProjectResults(projectId, hr);
      expect(results.frozen).toBe(true);
      const zs = results.reviewees[0]!;
      // 团队管理 = 1×0.5 + 4×0.5 = 2.5；managerScore = 2.5×0.6 + 4×0.4 = 3.1
      expect(zs.managerScore).toBeCloseTo(3.1, 6);
      // total = (3.1×40 + 5×30)/70 = 274/70
      expect(zs.totalScore).toBeCloseTo(274 / 70, 5);
      expect(zs.peerScore).toBeCloseTo(5, 6);
      expect(zs.submittedCount).toBe(3);
    });
  },
);
