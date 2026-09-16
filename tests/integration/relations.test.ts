import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import { createProject } from "@/modules/projects/service";
import {
  commitRelationsImport,
  createRelation,
  deleteRelation,
  listPeople,
  listRelations,
  previewRelationsImport,
  updateRelation,
} from "@/modules/review-relations/service";
import {
  generateRelationTemplate,
  RELATION_TEMPLATE_HEADERS,
} from "@/modules/review-relations/excel";

/**
 * Sprint 4 集成测试：人员与评价关系。
 * 覆盖 PRD 第 16~20 节：导入两阶段、预检查全场景、整体替换、
 * 自评自动生成、手工增删改、审计、权限、状态窗口、860 行性能。
 * 直连数据库调用 service 层（跳过 HTTP 层）；无数据库环境自动跳过。
 */
describe.skipIf(!process.env.DATABASE_URL)("人员与评价关系（Sprint 4）", () => {
  const HR1_NO = "it-s4-hr1";
  const EMP_NO = "it-s4-emp";
  const NAME_PREFIX = "IT-S4-";
  let hr1: User;
  let emp: User;

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
    const sheet = workbook.addWorksheet("评价关系");
    sheet.addRow([...RELATION_TEMPLATE_HEADERS]);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  function createTestProject(name: string, extra: object = {}) {
    return createProject(hr1, { name: `${NAME_PREFIX}${name}`, ...extra });
  }

  async function countRows(projectId: string) {
    const [people, relations, selfRelations, tasks] = await Promise.all([
      prisma.projectPerson.count({ where: { projectId } }),
      prisma.reviewRelation.count({ where: { projectId } }),
      prisma.reviewRelation.count({
        where: { projectId, relationType: "SELF" },
      }),
      prisma.reviewTask.count({ where: { projectId } }),
    ]);
    return { people, relations, selfRelations, tasks };
  }

  /** 查询指定 pair 的关系（含任务状态） */
  async function findRelation(
    projectId: string,
    revieweeNo: string,
    reviewerNo: string,
  ) {
    const [reviewee, reviewer] = await Promise.all([
      prisma.projectPerson.findUnique({
        where: { projectId_employeeNo: { projectId, employeeNo: revieweeNo } },
      }),
      prisma.projectPerson.findUnique({
        where: { projectId_employeeNo: { projectId, employeeNo: reviewerNo } },
      }),
    ]);
    if (!reviewee || !reviewer) return null;
    return prisma.reviewRelation.findUnique({
      where: {
        projectId_revieweePersonId_reviewerPersonId: {
          projectId,
          revieweePersonId: reviewee.id,
          reviewerPersonId: reviewer.id,
        },
      },
      include: { tasks: { select: { status: true } } },
    });
  }

  /** 模拟评价任务已提交（Sprint 5 之前直接改库） */
  async function submitTask(relationId: string) {
    await prisma.reviewTask.update({
      where: { relationId },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
  }

  beforeAll(async () => {
    const ensure = (employeeNo: string, name: string) =>
      prisma.user.upsert({
        where: { employeeNo },
        update: {},
        create: { employeeNo, name, systemRole: "USER" },
      });
    [hr1, emp] = await Promise.all([
      ensure(HR1_NO, "集成测试S4HR"),
      ensure(EMP_NO, "集成测试S4员工"),
    ]);
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { employeeNo: { in: [HR1_NO, EMP_NO] } },
    });
  });

  // ---------- 导入两阶段 ----------

  it("模板导入：Preview 计数正确且只读；Commit 写入人员/关系/任务并生成自评", async () => {
    const project = await createTestProject("模板导入");
    const buffer = await generateRelationTemplate();

    // Preview：只读预检，不写任何表
    const preview = await previewRelationsImport(project.id, hr1, buffer);
    expect(preview.total).toBe(4);
    expect(preview.valid).toBe(4);
    expect(preview.errors).toBe(0);
    expect(preview.duplicates).toBe(0);
    expect(preview.conflicts).toBe(0);
    expect(preview.people).toHaveLength(4); // 张三/李四/王五/赵六
    expect(await countRows(project.id)).toEqual({
      people: 0,
      relations: 0,
      selfRelations: 0,
      tasks: 0,
    });

    // Commit：人员合并 + 关系 + 任务 + 自评
    const result = await commitRelationsImport(project.id, hr1, buffer);
    expect(result).toMatchObject({
      peopleCreated: 4,
      peopleUpdated: 0,
      relationsCreated: 4,
      relationsUpdated: 0,
      relationsDeactivated: 0,
      relationsDeleted: 0,
      selfRelationsCreated: 2, // 张三、李四是被评人
    });
    expect(await countRows(project.id)).toEqual({
      people: 4,
      relations: 6, // 4 条非 SELF + 2 条 SELF
      selfRelations: 2,
      tasks: 6,
    });

    // 人员合并：李四作为评价人（仅工号姓名）+ 被评人（完整信息）→ 一条记录带完整信息
    const lisi = await prisma.projectPerson.findUnique({
      where: {
        projectId_employeeNo: {
          projectId: project.id,
          employeeNo: "10002",
        },
      },
    });
    expect(lisi?.name).toBe("李四");
    expect(lisi?.department).toBe("商品中心");
    expect(lisi?.position).toBe("商品总监");

    // 幂等：重复导入同一文件不产生重复数据
    const again = await commitRelationsImport(project.id, hr1, buffer);
    expect(again).toMatchObject({
      relationsCreated: 0,
      relationsUpdated: 0,
      relationsDeleted: 0,
      selfRelationsCreated: 0,
    });
    expect((await countRows(project.id)).relations).toBe(6);
  });

  it("预检查场景全覆盖（PRD 第 18 节）：空字段 / 非法类型 / 工号姓名冲突 / 重复 / 冲突", async () => {
    const project = await createTestProject("预检查");
    const buffer = await buildExcel([
      // r2: 被评人部门为空 → error
      ["10001", "张三", "", "商品经理", "经理级", "10002", "李四", "上级"],
      // r3: 非法关系类型 → error
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10003",
        "王五",
        "同事",
      ],
      // r4: 与 r5 工号姓名冲突（评价人 10004 姓名不同）→ error
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10004",
        "赵六",
        "上级",
      ],
      // r5: 10004 登记为"小赵"
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10004",
        "小赵",
        "上级",
      ],
      // r6: 与 r7 同 pair 同类型 → duplicate
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10005",
        "钱七",
        "平级",
      ],
      // r7: 重复行
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10005",
        "钱七",
        "平级",
      ],
      // r8: 与 r9 同 pair 不同类型 → conflict（r8 有效，r9 冲突）
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10006",
        "孙八",
        "下级",
      ],
      // r9: 冲突行
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10006",
        "孙八",
        "上级",
      ],
      // r10: 有效行
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
    ]);

    const preview = await previewRelationsImport(project.id, hr1, buffer);
    expect(preview.total).toBe(9);
    expect(preview.valid).toBe(4); // r4（首次登记）、r6、r8、r10
    expect(preview.errors).toBe(3); // r2、r3、r5（冲突报在后出现的行）
    expect(preview.duplicates).toBe(1); // r7
    expect(preview.conflicts).toBe(1); // r9

    const byRow = new Map(preview.issues.map((i) => [i.row, i]));
    expect(byRow.get(2)?.message).toContain("被评人部门为空");
    expect(byRow.get(3)?.message).toContain("非法关系类型");
    expect(byRow.get(4)?.message ?? byRow.get(5)?.message).toContain(
      "工号姓名冲突",
    );
    expect(byRow.get(7)?.type).toBe("duplicate");
    expect(byRow.get(9)?.type).toBe("conflict");

    // 总数守恒
    expect(
      preview.valid + preview.errors + preview.duplicates + preview.conflicts,
    ).toBe(preview.total);
  });

  it("Commit 拦截错误/冲突行（400 + 明细），不写入任何数据", async () => {
    const project = await createTestProject("拦截");
    const buffer = await buildExcel([
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
        "10002",
        "李四",
        "平级",
      ], // 冲突
    ]);
    const err = await expectApiError(
      () => commitRelationsImport(project.id, hr1, buffer),
      400,
    );
    const details = err.details as {
      issues: { row: number; type: string }[];
    };
    expect(details.issues).toHaveLength(1);
    expect(details.issues[0]!.type).toBe("conflict");
    expect(await countRows(project.id)).toEqual({
      people: 0,
      relations: 0,
      selfRelations: 0,
      tasks: 0,
    });
  });

  // ---------- 整体替换 ----------

  it("整体替换：旧关系移除、类型对齐、已提交关系软删并可恢复", async () => {
    const project = await createTestProject("替换");

    // 第一批：张三被李四（上级）、王五（平级）评价
    const batch1 = await buildExcel([
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
    ]);
    await commitRelationsImport(project.id, hr1, batch1);

    const managerRel = await findRelation(project.id, "10001", "10002");
    expect(managerRel?.relationType).toBe("MANAGER");
    await submitTask(managerRel!.id); // 李四已提交

    // 第二批：李四改为平级（类型对齐）、新增赵六（下级）、王五不在 Excel → 物理删除
    const batch2 = await buildExcel([
      [
        "10001",
        "张三",
        "商品中心",
        "商品经理",
        "经理级",
        "10002",
        "李四",
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
    ]);
    const result2 = await commitRelationsImport(project.id, hr1, batch2);
    expect(result2.relationsUpdated).toBe(1); // 李四：MANAGER → PEER
    expect(result2.relationsCreated).toBe(1); // 赵六
    expect(result2.relationsDeleted).toBe(1); // 王五未提交 → 物理删
    expect(result2.relationsDeactivated).toBe(0);
    expect(await findRelation(project.id, "10001", "10003")).toBeNull();

    // 第三批：移除已提交的李四 → 软删（历史保留）；王五回归 → 全新创建
    const batch3 = await buildExcel([
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
    ]);
    const result3 = await commitRelationsImport(project.id, hr1, batch3);
    expect(result3.relationsDeactivated).toBe(1); // 李四已提交 → active=false
    expect(result3.relationsCreated).toBe(1); // 王五重新创建
    const deactivated = await findRelation(project.id, "10001", "10002");
    expect(deactivated?.active).toBe(false); // 行保留，评分时排除

    // 第四批：李四回归（曾软删）→ 复用行恢复
    const batch4 = await buildExcel([
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
    ]);
    const result4 = await commitRelationsImport(project.id, hr1, batch4);
    expect(result4.relationsUpdated).toBe(1); // inactive 行恢复 active
    const restored = await findRelation(project.id, "10001", "10002");
    expect(restored?.active).toBe(true);
    expect(restored?.relationType).toBe("MANAGER");
    expect(restored?.id).toBe(deactivated?.id); // 复用同一行
  });

  // ---------- 自评 ----------

  it("自评：启用时自动生成；关闭时不生成；HR 删除过的自评不自动恢复", async () => {
    const project = await createTestProject("自评");
    const buffer = await buildExcel([
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
    ]);
    await commitRelationsImport(project.id, hr1, buffer);
    expect((await countRows(project.id)).selfRelations).toBe(1); // 张三自评

    // HR 删除已提交的自评 → 软删；重新导入不自动恢复（尊重删除动作）
    const self = await findRelation(project.id, "10001", "10001");
    expect(self?.relationType).toBe("SELF");
    await submitTask(self!.id);
    await deleteRelation(self!.id, hr1);
    const again = await commitRelationsImport(project.id, hr1, buffer);
    expect(again.selfRelationsCreated).toBe(0);
    expect((await findRelation(project.id, "10001", "10001"))?.active).toBe(
      false,
    );

    // 关闭自评的项目：导入不生成自评
    const disabled = await createTestProject("自评关闭", {
      selfReviewEnabled: false,
    });
    await commitRelationsImport(disabled.id, hr1, buffer);
    expect((await countRows(disabled.id)).selfRelations).toBe(0);

    // 手工新增被评人也不生成自评
    await createRelation(disabled.id, hr1, {
      revieweeEmployeeNo: "10003",
      revieweeName: "王五",
      revieweeDepartment: "商品中心",
      revieweePosition: "商品主管",
      revieweeGrade: "主管级",
      reviewerEmployeeNo: "10004",
      reviewerName: "赵六",
      relationType: "平级",
    });
    const wangwuSelf = await findRelation(disabled.id, "10003", "10003");
    expect(wangwuSelf).toBeNull();
  });

  // ---------- 手工调整（PRD 第 20 节）----------

  it("手工新增：创建人员与任务；同 pair 重复 409；软删行复用恢复", async () => {
    const project = await createTestProject("手工新增");
    const created = await createRelation(project.id, hr1, {
      revieweeEmployeeNo: "10001",
      revieweeName: "张三",
      revieweeDepartment: "商品中心",
      revieweePosition: "商品经理",
      revieweeGrade: "经理级",
      reviewerEmployeeNo: "10002",
      reviewerName: "李四",
      relationType: "上级",
    });
    expect(created.relationType).toBe("MANAGER");
    expect(created.taskStatus).toBe("NOT_STARTED");
    expect(created.active).toBe(true);
    expect((await countRows(project.id)).tasks).toBe(2); // 关系任务 + 张三自评

    // 同 pair 已有 active 关系 → 409
    await expectApiError(
      () =>
        createRelation(project.id, hr1, {
          revieweeEmployeeNo: "10001",
          reviewerEmployeeNo: "10002",
          reviewerName: "李四",
          relationType: "平级",
        }),
      409,
    );

    // 字段校验
    await expectApiError(
      () =>
        createRelation(project.id, hr1, {
          revieweeEmployeeNo: "",
          reviewerEmployeeNo: "10002",
          reviewerName: "李四",
          relationType: "上级",
        }),
      400,
    );

    // 已提交的软删行 → 手工新增复用恢复
    await submitTask((await findRelation(project.id, "10001", "10002"))!.id);
    await deleteRelation(created.id, hr1);
    const restored = await createRelation(project.id, hr1, {
      revieweeEmployeeNo: "10001",
      reviewerEmployeeNo: "10002",
      reviewerName: "李四",
      relationType: "上级",
    });
    expect(restored.active).toBe(true);
    expect(restored.id).toBe(created.id); // 复用软删行，历史保留
  });

  it("手工修改：类型变更 + CHANGE_RELATION 审计；SELF 固定不能改", async () => {
    const project = await createTestProject("手工修改");
    const buffer = await buildExcel([
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
    ]);
    await commitRelationsImport(project.id, hr1, buffer);

    const rel = await findRelation(project.id, "10001", "10002");
    const updated = await updateRelation(rel!.id, hr1, "平级");
    expect(updated.relationType).toBe("PEER");

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: rel!.id, action: "CHANGE_RELATION" },
    });
    expect(audit?.actorUserId).toBe(hr1.id);
    expect(audit?.projectId).toBe(project.id);
    expect(audit?.entityType).toBe("ReviewRelation");

    // SELF 不能修改类型
    const self = await findRelation(project.id, "10001", "10001");
    await expectApiError(() => updateRelation(self!.id, hr1, "上级"), 400);
  });

  it("手工删除：未提交物理删；已提交软删；均写 DELETE_RELATION 审计", async () => {
    const project = await createTestProject("手工删除");
    const buffer = await buildExcel([
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
    ]);
    await commitRelationsImport(project.id, hr1, buffer);

    // 未提交 → 物理删除 + 审计
    const lisi = await findRelation(project.id, "10001", "10002");
    const deleted = await deleteRelation(lisi!.id, hr1);
    expect(deleted.deactivated).toBe(false);
    expect(await findRelation(project.id, "10001", "10002")).toBeNull();
    const audit1 = await prisma.auditLog.findFirst({
      where: { entityId: lisi!.id, action: "DELETE_RELATION" },
    });
    expect(audit1).not.toBeNull();

    // 已提交 → 软删除 + 审计（评价不再参与结果，历史保留）
    const wangwu = await findRelation(project.id, "10001", "10003");
    await submitTask(wangwu!.id);
    const deactivated = await deleteRelation(wangwu!.id, hr1);
    expect(deactivated.deactivated).toBe(true);
    const row = await findRelation(project.id, "10001", "10003");
    expect(row?.active).toBe(false);
    const audit2 = await prisma.auditLog.findFirst({
      where: { entityId: wangwu!.id, action: "DELETE_RELATION" },
    });
    expect(audit2).not.toBeNull();
  });

  // ---------- 列表与快照 ----------

  it("列表：关系含双方信息与任务状态；人员含统计；项目快照互不影响", async () => {
    const p1 = await createTestProject("快照1");
    const p2 = await createTestProject("快照2");
    const buffer = await buildExcel([
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
    ]);
    await commitRelationsImport(p1.id, hr1, buffer);
    await commitRelationsImport(p2.id, hr1, buffer);

    // p2 中更新张三部门（只补空不覆盖逻辑走 HR 手工输入）
    await createRelation(p2.id, hr1, {
      revieweeEmployeeNo: "10003",
      revieweeName: "王五",
      revieweeDepartment: "市场部",
      reviewerEmployeeNo: "10001",
      reviewerName: "张三",
      relationType: "平级",
    });

    const relations = await listRelations(p1.id, hr1);
    expect(relations).toHaveLength(2); // 李四→张三 + 张三自评
    const manager = relations.find((r) => r.relationType === "MANAGER")!;
    expect(manager.reviewee.employeeNo).toBe("10001");
    expect(manager.reviewer.name).toBe("李四");
    expect(manager.taskStatus).toBe("NOT_STARTED");

    const people1 = await listPeople(p1.id, hr1);
    expect(people1).toHaveLength(2);
    const zhangsan1 = people1.find((p) => p.employeeNo === "10001")!;
    expect(zhangsan1.revieweeCount).toBe(1); // SELF 不计入
    expect(zhangsan1.reviewerCount).toBe(0);
    expect(zhangsan1.hasSelfRelation).toBe(true);
    const lisi1 = people1.find((p) => p.employeeNo === "10002")!;
    expect(lisi1.reviewerCount).toBe(1);
    expect(lisi1.hasSelfRelation).toBe(false);

    // 项目快照（铁律 6）：p2 的王五不影响 p1
    expect(people1.find((p) => p.employeeNo === "10003")).toBeUndefined();
    const people2 = await listPeople(p2.id, hr1);
    expect(people2.find((p) => p.employeeNo === "10003")?.department).toBe(
      "市场部",
    );
  });

  // ---------- 权限与状态窗口 ----------

  it("权限：非项目管理员无法预检 / 导入 / 手工调整 / 查看列表（403）", async () => {
    const project = await createTestProject("权限");
    const buffer = await buildExcel([
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
    ]);
    await expectApiError(
      () => previewRelationsImport(project.id, emp, buffer),
      403,
    );
    await expectApiError(
      () => commitRelationsImport(project.id, emp, buffer),
      403,
    );
    await expectApiError(
      () =>
        createRelation(project.id, emp, {
          revieweeEmployeeNo: "10001",
          reviewerEmployeeNo: "10002",
          reviewerName: "李四",
          relationType: "上级",
        }),
      403,
    );
    await expectApiError(() => listRelations(project.id, emp), 403);
    await expectApiError(() => listPeople(project.id, emp), 403);
  });

  it("状态窗口：FROZEN 项目禁止导入与手工调整（409）", async () => {
    const project = await createTestProject("冻结");
    const buffer = await buildExcel([
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
    ]);
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "FROZEN" },
    });
    await expectApiError(
      () => commitRelationsImport(project.id, hr1, buffer),
      409,
    );
    await expectApiError(
      () =>
        createRelation(project.id, hr1, {
          revieweeEmployeeNo: "10001",
          reviewerEmployeeNo: "10002",
          reviewerName: "李四",
          relationType: "上级",
        }),
      409,
    );
  });

  it("ACTIVE 状态仍可调整关系（PRD 第 20 节：已有提交也可调整）", async () => {
    const project = await createTestProject("测评中调整", {
      startAt: new Date(Date.now() + HOUR).toISOString(),
      endAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    });
    const buffer = await buildExcel([
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
    ]);
    await commitRelationsImport(project.id, hr1, buffer);
    await prisma.project.update({
      where: { id: project.id },
      data: { startAt: new Date(Date.now() - HOUR) }, // 惰性同步 → ACTIVE
    });
    const result = await commitRelationsImport(project.id, hr1, buffer);
    expect(result.relationsCreated).toBe(0); // 幂等，但未被 409 拦截
  });

  // ---------- 性能（MVP 验收：860 行量级 Preview 秒级）----------

  it("性能：860 行 Excel Preview 秒级返回，Commit 正常完成", async () => {
    const rows: (string | number)[][] = [];
    // 200 被评人 × 4 评价人 = 800 行；前 60 人加第 5 个评价人 = 860 行
    for (let i = 1; i <= 200; i++) {
      const no = `E${String(i).padStart(5, "0")}`;
      for (let j = 1; j <= 4; j++) {
        rows.push([
          no,
          `被评人${i}`,
          "商品中心",
          "商品经理",
          "经理级",
          `R${String(j).padStart(3, "0")}`,
          `评价人${j}`,
          j === 1 ? "上级" : j === 2 ? "平级" : "下级",
        ]);
      }
      if (i <= 60) {
        rows.push([
          no,
          `被评人${i}`,
          "商品中心",
          "商品经理",
          "经理级",
          "R005",
          "评价人5",
          "平级",
        ]);
      }
    }
    expect(rows).toHaveLength(860);
    const buffer = await buildExcel(rows);

    const project = await createTestProject("性能");

    const previewStart = Date.now();
    const preview = await previewRelationsImport(project.id, hr1, buffer);
    const previewMs = Date.now() - previewStart;
    expect(preview.total).toBe(860);
    expect(preview.valid).toBe(860);
    expect(preview.errors).toBe(0);
    expect(previewMs).toBeLessThan(5000); // 验收标准：秒级

    const commitStart = Date.now();
    const result = await commitRelationsImport(project.id, hr1, buffer);
    const commitMs = Date.now() - commitStart;
    expect(result.relationsCreated).toBe(860);
    expect(result.peopleCreated).toBe(205); // 200 被评人 + 5 评价人
    expect(result.selfRelationsCreated).toBe(200);
    expect(commitMs).toBeLessThan(15000);

    const counts = await countRows(project.id);
    expect(counts.relations).toBe(1060); // 860 + 200 SELF
    expect(counts.tasks).toBe(1060);
  });
});

/**
 * 人员主数据回填（Sprint 14 / PRD 16.1）：
 * 关系 Excel 里被评人部门/岗位/职级留空、以及评价人信息（Excel 无这些列）时，
 * 从全局人员主数据（User.department/position/grade）补全后写入项目快照。
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "人员主数据回填（Sprint 14）",
  () => {
    const HR_NO = "it-s14-hr";
    const R1_NO = "it-s14-r1"; // 被评人（主数据齐全）
    const V1_NO = "it-s14-v1"; // 评价人（主数据齐全）
    const NO_MASTER_NO = "it-s14-nomaster"; // 主数据也缺部门
    const NAME_PREFIX = "IT-S14-";
    let hr: User;

    async function buildExcel(rows: (string | number)[][]): Promise<Buffer> {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("评价关系");
      sheet.addRow([...RELATION_TEMPLATE_HEADERS]);
      for (const row of rows) sheet.addRow(row);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    }

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

    async function personOf(projectId: string, employeeNo: string) {
      return prisma.projectPerson.findUnique({
        where: { projectId_employeeNo: { projectId, employeeNo } },
      });
    }

    beforeAll(async () => {
      const ensure = (
        employeeNo: string,
        name: string,
        extra: { department?: string; position?: string; grade?: string } = {},
      ) =>
        prisma.user.upsert({
          where: { employeeNo },
          update: extra,
          create: { employeeNo, name, systemRole: "USER", ...extra },
        });
      hr = await ensure(HR_NO, "集成测试S14HR");
      await Promise.all([
        ensure(R1_NO, "回填被评人", {
          department: "商品中心",
          position: "商品经理",
          grade: "经理级",
        }),
        ensure(V1_NO, "回填评价人", {
          department: "供应链中心",
          position: "供应链专员",
          grade: "专员级",
        }),
        // 主数据里只有姓名，没有部门/岗位/职级
        ensure(NO_MASTER_NO, "无主数据人员"),
      ]);
    });

    afterAll(async () => {
      await prisma.project.deleteMany({
        where: { name: { startsWith: NAME_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { employeeNo: { in: [HR_NO, R1_NO, V1_NO, NO_MASTER_NO] } },
      });
    });

    /** Excel：被评人部门/岗位/职级全部留空（依赖主数据补全） */
    function excelWithBlankRevieweeFields(): Promise<Buffer> {
      return buildExcel([
        [R1_NO, "回填被评人", "", "", "", V1_NO, "回填评价人", "上级"],
      ]);
    }

    it("Preview：被评人三字段留空由主数据补全，评价人信息也取自主数据", async () => {
      const project = await createProject(hr, { name: `${NAME_PREFIX}预览` });
      const preview = await previewRelationsImport(
        project.id,
        hr,
        await excelWithBlankRevieweeFields(),
      );

      expect(preview.total).toBe(1);
      expect(preview.valid).toBe(1);
      expect(preview.errors).toBe(0);
      expect(preview.masterFilled).toBe(2); // 被评人 + 评价人

      const reviewee = preview.people.find((p) => p.employeeNo === R1_NO)!;
      expect(reviewee.department).toBe("商品中心");
      expect(reviewee.position).toBe("商品经理");
      expect(reviewee.grade).toBe("经理级");

      const reviewer = preview.people.find((p) => p.employeeNo === V1_NO)!;
      expect(reviewer.department).toBe("供应链中心");
      expect(reviewer.position).toBe("供应链专员");
      expect(reviewer.grade).toBe("专员级");

      // Preview 不写库
      expect(await personOf(project.id, R1_NO)).toBeNull();
    });

    it("Commit：补全结果写入项目人员快照（含评价人部门）", async () => {
      const project = await createProject(hr, { name: `${NAME_PREFIX}导入` });
      await commitRelationsImport(
        project.id,
        hr,
        await excelWithBlankRevieweeFields(),
      );

      const reviewee = await personOf(project.id, R1_NO);
      expect(reviewee?.department).toBe("商品中心");
      expect(reviewee?.position).toBe("商品经理");
      expect(reviewee?.grade).toBe("经理级");

      const reviewer = await personOf(project.id, V1_NO);
      expect(reviewer?.department).toBe("供应链中心");
      expect(reviewer?.position).toBe("供应链专员");
      expect(reviewer?.grade).toBe("专员级");
    });

    it("快照语义：导入后改主数据不影响已有快照，重新导入才按新主数据更新", async () => {
      const project = await createProject(hr, { name: `${NAME_PREFIX}快照` });
      await commitRelationsImport(
        project.id,
        hr,
        await excelWithBlankRevieweeFields(),
      );
      expect((await personOf(project.id, R1_NO))?.department).toBe("商品中心");

      // 用户管理里调整主数据（铁律 6：不影响已生成的项目快照）
      await prisma.user.update({
        where: { employeeNo: R1_NO },
        data: { department: "线下事业部" },
      });
      expect((await personOf(project.id, R1_NO))?.department).toBe("商品中心");

      // 再次导入（Excel 仍留空）→ 以当前主数据为准
      await commitRelationsImport(
        project.id,
        hr,
        await excelWithBlankRevieweeFields(),
      );
      expect((await personOf(project.id, R1_NO))?.department).toBe(
        "线下事业部",
      );

      // 还原主数据，避免影响其他用例
      await prisma.user.update({
        where: { employeeNo: R1_NO },
        data: { department: "商品中心" },
      });
    });

    it("Excel 留空且主数据也缺字段 → 仍按 PRD 16.1 报错并拦截 Commit", async () => {
      const project = await createProject(hr, {
        name: `${NAME_PREFIX}缺主数据`,
      });
      const buffer = await buildExcel([
        [NO_MASTER_NO, "无主数据人员", "", "", "", V1_NO, "回填评价人", "上级"],
      ]);

      const preview = await previewRelationsImport(project.id, hr, buffer);
      expect(preview.errors).toBe(1);
      expect(preview.valid).toBe(0);
      expect(preview.issues[0]!.message).toContain(
        "被评人部门为空（Excel 与人员主数据均无）",
      );

      const err = await expectApiError(
        () => commitRelationsImport(project.id, hr, buffer),
        400,
      );
      const details = err.details as { issues: { message: string }[] };
      expect(details.issues[0]!.message).toContain("被评人部门为空");
      expect(await personOf(project.id, NO_MASTER_NO)).toBeNull();
    });

    it("手工新增关系同样按主数据补全（无需手填部门/岗位/职级）", async () => {
      const project = await createProject(hr, { name: `${NAME_PREFIX}手工` });
      await createRelation(project.id, hr, {
        revieweeEmployeeNo: R1_NO,
        revieweeName: "回填被评人",
        reviewerEmployeeNo: V1_NO,
        reviewerName: "回填评价人",
        relationType: "上级",
      });

      const reviewee = await personOf(project.id, R1_NO);
      expect(reviewee?.department).toBe("商品中心");
      expect(reviewee?.grade).toBe("经理级");
      const reviewer = await personOf(project.id, V1_NO);
      expect(reviewer?.department).toBe("供应链中心");
    });
  },
);
