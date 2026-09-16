import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import { createProject, publishProject } from "@/modules/projects/service";
import {
  getProjectQuestionnaire,
  saveProjectQuestionnaire,
} from "@/modules/questionnaires/service";
import type { QuestionnaireData } from "@/modules/questionnaires/validate";

/**
 * Sprint 12 集成测试：在线问卷编辑（整树保存，PRD 第 12.1 / 11.1 / 14 节）。
 * 直连 service 层；无数据库环境自动跳过。
 */

const ALL_TRUE = { self: true, manager: true, peer: true, subordinate: true };

describe.skipIf(!process.env.DATABASE_URL)("在线问卷编辑（Sprint 12）", () => {
  const HR_NO = "it-s12-hr";
  const EMP_NO = "it-s12-emp";
  const NAME_PREFIX = "IT-S12-";
  const HOUR = 60 * 60 * 1000;
  let hr: User;
  let emp: User;

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

  function createTestProject(name: string, extra: object = {}) {
    return createProject(hr, { name: `${NAME_PREFIX}${name}`, ...extra });
  }

  /** 常见的「可发布」问卷：2 个一级维度 60/40，题目权重各自 100% */
  function validPayload(): QuestionnaireData {
    return {
      dimensions: [
        {
          key: "d1",
          parentKey: null,
          name: "团队管理",
          description: null,
          weight: 60,
          order: 0,
          applicable: ALL_TRUE,
        },
        {
          key: "d2",
          parentKey: null,
          name: "专业能力",
          description: null,
          weight: 40,
          order: 1,
          applicable: ALL_TRUE,
        },
      ],
      questions: [
        {
          dimensionKey: "d1",
          code: "Q1",
          type: "RATING",
          title: "团队目标清晰",
          description: null,
          weight: 100,
          required: true,
          order: 0,
          overrideRelationRules: false,
          applicable: ALL_TRUE,
        },
        {
          dimensionKey: "d2",
          code: "Q2",
          type: "RATING",
          title: "专业深度",
          description: null,
          weight: 100,
          required: true,
          order: 0,
          overrideRelationRules: false,
          applicable: ALL_TRUE,
        },
        {
          dimensionKey: "d2",
          code: "Q3",
          type: "TEXT",
          title: "补充建议",
          description: "请具体描述",
          weight: null,
          required: false,
          order: 1,
          overrideRelationRules: false,
          applicable: ALL_TRUE,
        },
      ],
    };
  }

  beforeAll(async () => {
    const ensure = (employeeNo: string, name: string) =>
      prisma.user.upsert({
        where: { employeeNo },
        update: {},
        create: { employeeNo, name, systemRole: "USER" },
      });
    [hr, emp] = await Promise.all([
      ensure(HR_NO, "集成测试S12HR"),
      ensure(EMP_NO, "集成测试S12员工"),
    ]);
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { employeeNo: { in: [HR_NO, EMP_NO] } },
    });
  });

  it("从零在线搭建：保存维度与题目并落库，权重合法时无校验错误", async () => {
    const project = await createTestProject("从零搭建");
    const result = await saveProjectQuestionnaire(
      project.id,
      hr,
      validPayload(),
    );

    expect(result.validationErrors).toEqual([]);
    expect(result.questionnaire.dimensionCount).toBe(2);
    expect(result.questionnaire.questionCount).toBe(3);
    expect(result.questionnaire.dimensions.map((d) => d.name)).toEqual([
      "团队管理",
      "专业能力",
    ]);
    expect(result.questionnaire.dimensions[0]!.weight).toBe(60);
    // 题目按数组顺序落库，TEXT 题权重为空
    expect(
      result.questionnaire.dimensions[1]!.questions.map((q) => q.code),
    ).toEqual(["Q2", "Q3"]);
    expect(result.questionnaire.dimensions[1]!.questions[1]!.weight).toBeNull();
  });

  it("维度级适用关系落库（PRD 11.1）：某维度只适用上级+平级", async () => {
    const project = await createTestProject("维度适用关系");
    const payload = validPayload();
    payload.dimensions[0]!.applicable = {
      self: false,
      manager: true,
      peer: true,
      subordinate: false,
    };
    const { questionnaire } = await saveProjectQuestionnaire(
      project.id,
      hr,
      payload,
    );

    const team = questionnaire.dimensions[0]!;
    expect(team.applicableSelf).toBe(false);
    expect(team.applicableManager).toBe(true);
    expect(team.applicablePeer).toBe(true);
    expect(team.applicableSubordinate).toBe(false);
    // 题目未覆盖 → 继承维度规则
    expect(team.questions[0]!.overrideRelationRules).toBe(false);

    // 二级维度同样支持维度级配置
    const withChild: QuestionnaireData = {
      dimensions: [
        {
          key: "p",
          parentKey: null,
          name: "专业能力",
          description: null,
          weight: 100,
          order: 0,
          applicable: {
            self: true,
            manager: true,
            peer: false,
            subordinate: false,
          },
        },
        {
          key: "c",
          parentKey: "p",
          name: "技术深度",
          description: null,
          weight: 100,
          order: 0,
          applicable: {
            self: false,
            manager: true,
            peer: true,
            subordinate: false,
          },
        },
      ],
      questions: [
        {
          dimensionKey: "c",
          code: "Q1",
          type: "RATING",
          title: "技术深度",
          description: null,
          weight: 100,
          required: true,
          order: 0,
          overrideRelationRules: false,
          applicable: ALL_TRUE,
        },
      ],
    };
    const { questionnaire: nested } = await saveProjectQuestionnaire(
      project.id,
      hr,
      withChild,
    );
    expect(nested.dimensions[0]!.children[0]!.applicablePeer).toBe(true);
    expect(nested.dimensions[0]!.children[0]!.applicableSelf).toBe(false);
  });

  it("排序与跨维度移动：按数组顺序落库，题目可移到另一维度", async () => {
    const project = await createTestProject("排序移动");
    await saveProjectQuestionnaire(project.id, hr, validPayload());

    // 交换两个维度顺序 + 把 Q2 从「专业能力」移到「团队管理」
    const payload: QuestionnaireData = {
      dimensions: [
        {
          key: "d2",
          parentKey: null,
          name: "专业能力",
          description: null,
          weight: 40,
          order: 0,
          applicable: ALL_TRUE,
        },
        {
          key: "d1",
          parentKey: null,
          name: "团队管理",
          description: null,
          weight: 60,
          order: 1,
          applicable: ALL_TRUE,
        },
      ],
      questions: [
        {
          dimensionKey: "d2",
          code: "Q3",
          type: "TEXT",
          title: "补充建议",
          description: null,
          weight: null,
          required: false,
          order: 0,
          overrideRelationRules: false,
          applicable: ALL_TRUE,
        },
        {
          dimensionKey: "d1",
          code: "Q2",
          type: "RATING",
          title: "专业深度",
          description: null,
          weight: 100,
          required: true,
          order: 0,
          overrideRelationRules: false,
          applicable: ALL_TRUE,
        },
        {
          dimensionKey: "d1",
          code: "Q1",
          type: "RATING",
          title: "团队目标清晰",
          description: null,
          weight: 100,
          required: true,
          order: 1,
          overrideRelationRules: false,
          applicable: ALL_TRUE,
        },
      ],
    };
    const { questionnaire } = await saveProjectQuestionnaire(
      project.id,
      hr,
      payload,
    );

    expect(questionnaire.dimensions.map((d) => d.name)).toEqual([
      "专业能力",
      "团队管理",
    ]);
    const team = questionnaire.dimensions[1]!;
    expect(team.questions.map((q) => q.code)).toEqual(["Q2", "Q1"]);
    expect(team.questions.map((q) => q.order)).toEqual([0, 1]);
    const pro = questionnaire.dimensions[0]!;
    expect(pro.questions.map((q) => q.code)).toEqual(["Q3"]);
  });

  it("复制与删除：复制题目生成新编号即可保存，删除维度连带题目消失", async () => {
    const project = await createTestProject("复制删除");
    await saveProjectQuestionnaire(project.id, hr, validPayload());

    const withCopy = validPayload();
    withCopy.questions.push({
      dimensionKey: "d1",
      code: "Q1副本",
      type: "RATING",
      title: "团队目标清晰",
      description: null,
      weight: 100,
      required: true,
      order: 1,
      overrideRelationRules: false,
      applicable: ALL_TRUE,
    });
    const copied = await saveProjectQuestionnaire(project.id, hr, withCopy);
    // 复制后同维度内权重不再等于 100%（50/50 才合法）→ 应给出校验提示但能保存
    expect(
      copied.validationErrors.some((e) => e.message.includes("100%")),
    ).toBe(true);
    expect(copied.questionnaire.questionCount).toBe(4);

    // 修好权重后无错误：一级维度 50/50，团队管理下两题各 50%
    withCopy.dimensions[0]!.weight = 50;
    withCopy.dimensions[1]!.weight = 50;
    withCopy.questions[0]!.weight = 50;
    withCopy.questions[3]!.weight = 50;
    const fixed = await saveProjectQuestionnaire(project.id, hr, withCopy);
    expect(fixed.validationErrors).toEqual([]);

    const removed: QuestionnaireData = {
      dimensions: [withCopy.dimensions[0]!],
      questions: withCopy.questions.filter((q) => q.dimensionKey === "d1"),
    };
    const after = await saveProjectQuestionnaire(project.id, hr, removed);
    expect(after.questionnaire.dimensionCount).toBe(1);
    expect(after.questionnaire.questionCount).toBe(2);
    expect(after.questionnaire.dimensions[0]!.name).toBe("团队管理");
  });

  it("允许保存中间状态：权重不足 100% 仍可保存并回传校验错误", async () => {
    const project = await createTestProject("中间状态");
    const payload = validPayload();
    payload.dimensions[0]!.weight = 60;
    payload.dimensions[1]!.weight = 50; // 合计 110%
    const { questionnaire, validationErrors } = await saveProjectQuestionnaire(
      project.id,
      hr,
      payload,
    );
    expect(validationErrors.length).toBeGreaterThan(0);
    expect(validationErrors[0]!.message).toContain("100%");
    // 数据仍然写入，便于继续编辑
    expect(questionnaire.dimensionCount).toBe(2);
  });

  it("发布前强校验（PRD 14）：中间状态问卷不能发布，修正后可发布", async () => {
    const project = await createTestProject("发布拦截", {
      startAt: new Date(Date.now() + HOUR).toISOString(),
      endAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    });
    const payload = validPayload();
    payload.dimensions[1]!.weight = 30; // 合计 90%
    await saveProjectQuestionnaire(project.id, hr, payload);

    const err = await expectApiError(() => publishProject(project.id, hr), 400);
    const details = err.details as {
      validationErrors: { path: string; message: string }[];
    };
    expect(details.validationErrors.length).toBeGreaterThan(0);
    expect(details.validationErrors[0]!.message).toContain("100%");

    payload.dimensions[1]!.weight = 40;
    await saveProjectQuestionnaire(project.id, hr, payload);
    const published = await publishProject(project.id, hr);
    expect(published.status).toBe("PUBLISHED");
  });

  it("修改窗口守卫：锁定后 409；项目进入 ACTIVE 后 409", async () => {
    const locked = await createTestProject("锁定");
    await saveProjectQuestionnaire(locked.id, hr, validPayload());
    await prisma.questionnaire.update({
      where: { projectId: locked.id },
      data: { lockedAt: new Date() },
    });
    await expectApiError(
      () => saveProjectQuestionnaire(locked.id, hr, validPayload()),
      409,
    );

    const active = await createTestProject("测评中", {
      startAt: new Date(Date.now() + HOUR).toISOString(),
      endAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    });
    await saveProjectQuestionnaire(active.id, hr, validPayload());
    await publishProject(active.id, hr);
    await prisma.project.update({
      where: { id: active.id },
      data: { startAt: new Date(Date.now() - HOUR) },
    });
    await expectApiError(
      () => saveProjectQuestionnaire(active.id, hr, validPayload()),
      409,
    );
  });

  it("权限：非项目管理员不能保存（403）", async () => {
    const project = await createTestProject("权限");
    await expectApiError(
      () => saveProjectQuestionnaire(project.id, emp, validPayload()),
      403,
    );
    expect(await getProjectQuestionnaire(project.id, hr)).toBeNull();
  });

  it("允许保存空问卷（从零开始 / 清空后重新搭建）", async () => {
    const project = await createTestProject("空问卷");
    const { questionnaire, validationErrors } = await saveProjectQuestionnaire(
      project.id,
      hr,
      { dimensions: [], questions: [] },
    );
    expect(questionnaire.dimensionCount).toBe(0);
    expect(questionnaire.questionCount).toBe(0);
    // 空问卷不允许发布（发布校验兜底）
    expect(validationErrors.length).toBeGreaterThan(0);
    await expectApiError(() => publishProject(project.id, hr), 400);
  });

  it("入参校验：结构非法直接 400（缺字段 / key 重复 / 维度不存在 / 题型非法）", async () => {
    const project = await createTestProject("入参校验");
    const base = validPayload();

    // 缺少 applicable 四个布尔值
    await expectApiError(
      () =>
        saveProjectQuestionnaire(project.id, hr, {
          ...base,
          dimensions: [{ ...base.dimensions[0]!, applicable: undefined }],
          questions: [],
        }),
      400,
    );
    // 维度 key 重复
    await expectApiError(
      () =>
        saveProjectQuestionnaire(project.id, hr, {
          dimensions: [base.dimensions[0]!, base.dimensions[0]!],
          questions: [],
        }),
      400,
    );
    // 题目引用不存在的维度
    await expectApiError(
      () =>
        saveProjectQuestionnaire(project.id, hr, {
          dimensions: [base.dimensions[0]!],
          questions: [{ ...base.questions[0]!, dimensionKey: "nope" }],
        }),
      400,
    );
    // 题型非法
    await expectApiError(
      () =>
        saveProjectQuestionnaire(project.id, hr, {
          dimensions: [base.dimensions[0]!],
          questions: [{ ...base.questions[0]!, type: "SCALE" }],
        }),
      400,
    );
    // 非法入参不得写入（此前只有 validPayload 之外的数据，此处应仍为空）
    expect(await getProjectQuestionnaire(project.id, hr)).toBeNull();
  });
});
