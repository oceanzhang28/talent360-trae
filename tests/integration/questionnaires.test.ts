import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import { createProject, publishProject } from "@/modules/projects/service";
import {
  applyTemplate,
  checkQuestionnaireExcel,
  deleteTemplate,
  getProjectQuestionnaire,
  getTemplateDetail,
  importQuestionnaire,
  listTemplates,
  renameTemplate,
  saveAsTemplate,
} from "@/modules/questionnaires/service";
import {
  generateQuestionnaireTemplate,
  TEMPLATE_HEADERS,
} from "@/modules/questionnaires/excel";

/**
 * Sprint 3 集成测试：问卷 Excel 导入 / 校验 / 锁定 / 发布校验 / 模板。
 * 直连数据库调用 service 层（跳过 HTTP 层）；无数据库环境自动跳过。
 */
describe.skipIf(!process.env.DATABASE_URL)("问卷（Sprint 3）", () => {
  const HR1_NO = "it-s3-hr1";
  const EMP_NO = "it-s3-emp";
  const ADMIN_NO = "it-s3-admin";
  const NAME_PREFIX = "IT-S3-";
  const TEMPLATE_PREFIX = "IT-S3 模板";
  let hr1: User;
  let emp: User;
  let admin: User;

  const HOUR = 60 * 60 * 1000;

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

  async function buildExcel(rows: (string | number)[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("问卷");
    sheet.addRow([...TEMPLATE_HEADERS]);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  function createTestProject(name: string, extra: object = {}) {
    return createProject(hr1, { name: `${NAME_PREFIX}${name}`, ...extra });
  }

  beforeAll(async () => {
    const ensure = (employeeNo: string, name: string) =>
      prisma.user.upsert({
        where: { employeeNo },
        update: {},
        create: { employeeNo, name, systemRole: "USER" },
      });
    [hr1, emp] = await Promise.all([
      ensure(HR1_NO, "集成测试S3HR"),
      ensure(EMP_NO, "集成测试S3员工"),
    ]);
    admin = await prisma.user.upsert({
      where: { employeeNo: ADMIN_NO },
      update: { systemRole: "SYSTEM_ADMIN" },
      create: {
        employeeNo: ADMIN_NO,
        name: "集成测试S3管理员",
        systemRole: "SYSTEM_ADMIN",
      },
    });
  });

  afterAll(async () => {
    // 模板独立于项目存在，需单独清理；项目删除级联问卷
    await prisma.questionnaire.deleteMany({
      where: {
        isTemplate: true,
        templateName: { startsWith: TEMPLATE_PREFIX },
      },
    });
    await prisma.project.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { employeeNo: { in: [HR1_NO, EMP_NO, ADMIN_NO] } },
    });
  });

  it("Excel 模板导入成功：树结构、权重与题目属性正确", async () => {
    const project = await createTestProject("导入");
    const dto = await importQuestionnaire(
      project.id,
      hr1,
      await generateQuestionnaireTemplate(),
    );
    expect(dto.lockedAt).toBeNull();
    expect(dto.dimensionCount).toBe(4); // 团队管理 + 专业能力 + 2 个二级
    expect(dto.questionCount).toBe(5);
    expect(dto.dimensions.map((d) => d.name)).toEqual(["团队管理", "专业能力"]);

    const team = dto.dimensions[0]!;
    expect(team.weight).toBe(60);
    expect(team.children).toHaveLength(0);
    expect(team.questions.map((q) => q.code)).toEqual(["Q1", "Q2"]);

    const pro = dto.dimensions[1]!;
    expect(pro.children.map((c) => c.name)).toEqual(["技术深度", "技术广度"]);
    const breadth = pro.children[1]!;
    expect(breadth.questions.map((q) => q.code)).toEqual(["Q4", "Q5"]);
    const q5 = breadth.questions[1]!;
    expect(q5.type).toBe("TEXT");
    expect(q5.weight).toBeNull();
    expect(q5.required).toBe(false);
    expect(q5.description).toBe("请具体描述");
    expect(q5.overrideRelationRules).toBe(true);
    expect(q5.applicablePeer).toBe(false);
    expect(q5.applicableSubordinate).toBe(true);
  });

  it("重复导入 = 整体替换，不产生重复数据", async () => {
    const project = await createTestProject("替换");
    const buffer = await generateQuestionnaireTemplate();
    await importQuestionnaire(project.id, hr1, buffer);
    const dto = await importQuestionnaire(project.id, hr1, buffer);
    expect(dto.questionCount).toBe(5);
    const dbCount = await prisma.question.count({
      where: { dimension: { questionnaire: { projectId: project.id } } },
    });
    expect(dbCount).toBe(5);
  });

  it("权重非法的 Excel 被拦截并返回错误明细，不写入", async () => {
    const project = await createTestProject("权重错误");
    const buffer = await buildExcel([
      [
        "A维度",
        "",
        "60",
        "",
        "",
        "Q1",
        "题干",
        "",
        "量表",
        "100",
        "必填",
        "",
        "",
        "",
        "",
        "1",
      ],
      [
        "B维度",
        "",
        "50",
        "",
        "",
        "Q2",
        "题干",
        "",
        "量表",
        "100",
        "必填",
        "",
        "",
        "",
        "",
        "1",
      ],
    ]);
    const err = await expectApiError(
      () => importQuestionnaire(project.id, hr1, buffer),
      400,
    );
    const details = err.details as {
      validationErrors: { path: string; message: string }[];
    };
    expect(details.validationErrors.length).toBeGreaterThan(0);
    expect(details.validationErrors[0]!.message).toContain("100%");

    // 校验接口同样检出且不写入
    const check = await checkQuestionnaireExcel(buffer);
    expect(check.validationErrors.length).toBeGreaterThan(0);
    expect(await getProjectQuestionnaire(project.id, hr1)).toBeNull();
  });

  it("格式错误（缺题目编号）返回行级错误", async () => {
    const buffer = await buildExcel([
      [
        "A维度",
        "",
        "100",
        "",
        "",
        "",
        "缺编号的题",
        "",
        "量表",
        "100",
        "必填",
        "",
        "",
        "",
        "",
        "1",
      ],
    ]);
    const check = await checkQuestionnaireExcel(buffer);
    expect(check.parseErrors).toHaveLength(1);
    expect(check.parseErrors[0]!.row).toBe(2);
    expect(check.parseErrors[0]!.message).toContain("题目编号");
  });

  it("锁定后（lockedAt）禁止导入与应用模板（409）", async () => {
    const project = await createTestProject("锁定");
    await importQuestionnaire(
      project.id,
      hr1,
      await generateQuestionnaireTemplate(),
    );
    // 模拟首次正式提交后的锁定（Sprint 5 评价提交时设置）
    await prisma.questionnaire.update({
      where: { projectId: project.id },
      data: { lockedAt: new Date() },
    });
    const dto = await getProjectQuestionnaire(project.id, hr1);
    expect(dto?.lockedAt).not.toBeNull();
    await expectApiError(
      async () =>
        importQuestionnaire(
          project.id,
          hr1,
          await generateQuestionnaireTemplate(),
        ),
      409,
    );
  });

  it("测评开始（ACTIVE）后禁止修改问卷（409）", async () => {
    const project = await createTestProject("测评中", {
      startAt: new Date(Date.now() + HOUR).toISOString(),
      endAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    });
    await importQuestionnaire(
      project.id,
      hr1,
      await generateQuestionnaireTemplate(),
    );
    await publishProject(project.id, hr1);
    // 惰性同步：把开始时间改到过去，触发 PUBLISHED → ACTIVE
    await prisma.project.update({
      where: { id: project.id },
      data: { startAt: new Date(Date.now() - HOUR) },
    });
    await expectApiError(
      async () =>
        importQuestionnaire(
          project.id,
          hr1,
          await generateQuestionnaireTemplate(),
        ),
      409,
    );
  });

  it("发布校验：无问卷不能发布；导入问卷后可发布", async () => {
    const project = await createTestProject("发布校验", {
      startAt: new Date(Date.now() + HOUR).toISOString(),
      endAt: new Date(Date.now() + 48 * HOUR).toISOString(),
      managerWeight: 40,
      peerWeight: 30,
      subordinateWeight: 30,
    });
    await expectApiError(() => publishProject(project.id, hr1), 400);
    await importQuestionnaire(
      project.id,
      hr1,
      await generateQuestionnaireTemplate(),
    );
    const published = await publishProject(project.id, hr1);
    expect(published.status).toBe("PUBLISHED");
  });

  it("模板：保存 → 列表可见 → 应用到新项目内容一致；同名模板 409", async () => {
    const source = await createTestProject("模板源");
    await importQuestionnaire(
      source.id,
      hr1,
      await generateQuestionnaireTemplate(),
    );
    const template = await saveAsTemplate(
      source.id,
      hr1,
      `${TEMPLATE_PREFIX}通用`,
    );
    expect(template.dimensionCount).toBe(4);
    expect(template.questionCount).toBe(5);

    await expectApiError(
      () => saveAsTemplate(source.id, hr1, `${TEMPLATE_PREFIX}通用`),
      409,
    );

    const templates = await listTemplates();
    const found = templates.find((t) => t.id === template.id);
    expect(found?.templateName).toBe(`${TEMPLATE_PREFIX}通用`);
    expect(found?.questionCount).toBe(5);

    const target = await createTestProject("模板目标");
    const applied = await applyTemplate(target.id, hr1, template.id);
    const sourceDto = await getProjectQuestionnaire(source.id, hr1);
    expect(applied.questionCount).toBe(5);
    expect(applied.dimensions).toEqual(sourceDto?.dimensions);

    // 应用后源项目问卷不受影响
    expect(sourceDto?.questionCount).toBe(5);
  });

  it("权限：非项目管理员不能导入 / 保存模板（403）", async () => {
    const project = await createTestProject("权限");
    await expectApiError(
      async () =>
        importQuestionnaire(
          project.id,
          emp,
          await generateQuestionnaireTemplate(),
        ),
      403,
    );
    await expectApiError(
      () => saveAsTemplate(project.id, emp, `${TEMPLATE_PREFIX}越权`),
      403,
    );
  });

  it("模板库管理：详情 / 重命名 / 同名冲突 / 删除不影响已复制的项目问卷", async () => {
    const source = await createTestProject("模板管理源");
    await importQuestionnaire(
      source.id,
      hr1,
      await generateQuestionnaireTemplate(),
    );
    const template = await saveAsTemplate(
      source.id,
      hr1,
      `${TEMPLATE_PREFIX}管理`,
    );
    expect(template.createdById).toBe(hr1.id);

    // 复制到目标项目（深拷贝，独立存在）
    const target = await createTestProject("模板管理目标");
    await applyTemplate(target.id, hr1, template.id);

    // 列表带创建者；详情返回维度树
    const listed = (await listTemplates()).find((t) => t.id === template.id);
    expect(listed?.createdById).toBe(hr1.id);
    const detail = await getTemplateDetail(template.id);
    expect(detail.dimensionCount).toBe(4);
    expect(detail.questionCount).toBe(5);
    expect(detail.dimensions.map((d) => d.name)).toEqual([
      "团队管理",
      "专业能力",
    ]);

    // 重命名
    const renamed = await renameTemplate(
      template.id,
      hr1,
      `${TEMPLATE_PREFIX}管理改名`,
    );
    expect(renamed.templateName).toBe(`${TEMPLATE_PREFIX}管理改名`);
    expect(renamed.dimensionCount).toBe(4);

    // 同名冲突 409；改成自己当前名字应放行（幂等）
    const another = await saveAsTemplate(
      source.id,
      hr1,
      `${TEMPLATE_PREFIX}另一个`,
    );
    await expectApiError(
      () => renameTemplate(another.id, hr1, `${TEMPLATE_PREFIX}管理改名`),
      409,
    );
    const same = await renameTemplate(
      another.id,
      hr1,
      `${TEMPLATE_PREFIX}另一个`,
    );
    expect(same.templateName).toBe(`${TEMPLATE_PREFIX}另一个`);

    // 空名称 400
    await expectApiError(() => renameTemplate(another.id, hr1, "   "), 400);

    // 权限：非创建者且非系统管理员
    await expectApiError(
      () => renameTemplate(another.id, emp, `${TEMPLATE_PREFIX}越权改名`),
      403,
    );
    await expectApiError(() => deleteTemplate(another.id, emp), 403);
    await expectApiError(() => getTemplateDetail("not-exist"), 404);

    // 删除模板：模板消失，但已复制的项目问卷与源项目问卷都不受影响（PRD 第 13 节）
    await deleteTemplate(template.id, hr1);
    await expectApiError(() => getTemplateDetail(template.id), 404);
    const targetDto = await getProjectQuestionnaire(target.id, hr1);
    expect(targetDto?.questionCount).toBe(5);
    expect(targetDto?.dimensions.map((d) => d.name)).toEqual([
      "团队管理",
      "专业能力",
    ]);
    expect((await getProjectQuestionnaire(source.id, hr1))?.questionCount).toBe(
      5,
    );

    await deleteTemplate(another.id, hr1);
    expect((await listTemplates()).some((t) => t.id === another.id)).toBe(
      false,
    );
  });

  it("历史模板（无创建者）：创建者本人也不能改，系统管理员可以", async () => {
    const source = await createTestProject("历史模板源");
    await importQuestionnaire(
      source.id,
      hr1,
      await generateQuestionnaireTemplate(),
    );
    const template = await saveAsTemplate(
      source.id,
      hr1,
      `${TEMPLATE_PREFIX}历史`,
    );
    // 模拟迁移前创建的模板（createdById 为空）
    await prisma.questionnaire.update({
      where: { id: template.id },
      data: { createdById: null },
    });

    await expectApiError(
      () => renameTemplate(template.id, hr1, `${TEMPLATE_PREFIX}历史改名`),
      403,
    );
    const renamed = await renameTemplate(
      template.id,
      admin,
      `${TEMPLATE_PREFIX}历史改名`,
    );
    expect(renamed.templateName).toBe(`${TEMPLATE_PREFIX}历史改名`);
    await deleteTemplate(template.id, admin);
    await expectApiError(() => getTemplateDetail(template.id), 404);
  });
});
