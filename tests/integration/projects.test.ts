import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/permissions";
import {
  addAdmin,
  archiveProject,
  closeProject,
  createProject,
  deleteProject,
  freezeProject,
  getProject,
  listProjects,
  publishProject,
  removeAdmin,
  unfreezeProject,
  updateProject,
  updateScaleLabels,
} from "@/modules/projects/service";

/**
 * Sprint 2 集成测试：项目状态机 / 权限 / 发布校验 / 时间操作 / 管理员 / 档位 / 软删除。
 * 直连数据库调用 service 层（跳过 HTTP 层）；无数据库环境自动跳过。
 */
describe.skipIf(!process.env.DATABASE_URL)("项目管理（Sprint 2）", () => {
  const HR1_NO = "it-s2-hr1";
  const HR2_NO = "it-s2-hr2";
  const EMP_NO = "it-s2-emp";
  const ADMIN_NO = "00000"; // prisma/seed.ts 播种的系统管理员
  const NAME_PREFIX = "IT-S2-";
  let hr1: User;
  let hr2: User;
  let emp: User;
  let admin: User;

  const iso = (offsetMs: number) =>
    new Date(Date.now() + offsetMs).toISOString();
  const HOUR = 60 * 60 * 1000;

  async function expectApiError(fn: () => Promise<unknown>, status: number) {
    try {
      await fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(status);
      return;
    }
    throw new Error(`预期抛出 ${status}，但未抛出异常`);
  }

  beforeAll(async () => {
    const ensure = (
      employeeNo: string,
      name: string,
      systemRole: "USER" | "SYSTEM_ADMIN",
    ) =>
      prisma.user.upsert({
        where: { employeeNo },
        update: { systemRole },
        create: { employeeNo, name, systemRole },
      });
    [hr1, hr2, emp, admin] = await Promise.all([
      ensure(HR1_NO, "集成测试HR1", "USER"),
      ensure(HR2_NO, "集成测试HR2", "USER"),
      ensure(EMP_NO, "集成测试员工", "USER"),
      prisma.user.findUniqueOrThrow({ where: { employeeNo: ADMIN_NO } }),
    ]);
  });

  afterAll(async () => {
    // 先删项目（级联清理 admins/scales），再删测试用户
    await prisma.project.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { employeeNo: { in: [HR1_NO, HR2_NO, EMP_NO] } },
    });
  });

  it("创建项目：创建者自动成为管理员，播种默认 10 档评分档位", async () => {
    const project = await createProject(hr1, {
      name: `${NAME_PREFIX}基础项目`,
      managerWeight: 40,
      peerWeight: 30,
      subordinateWeight: 30,
    });
    expect(project.status).toBe("DRAFT");

    const { admins, scales } = await getProject(project.id, hr1);
    expect(admins).toHaveLength(1);
    expect(admins[0].employeeNo).toBe(HR1_NO);
    expect(scales).toHaveLength(10);
    expect(scales[0].value).toBe(0.5);
    expect(scales[9].value).toBe(5);
    expect(scales.map((s) => s.label)).toContain("持续稳定体现");
  });

  it("项目列表：HR 只能看到自己管理的项目，系统管理员可见全部", async () => {
    const mine = await createProject(hr1, { name: `${NAME_PREFIX}HR1专属` });
    await createProject(hr2, { name: `${NAME_PREFIX}HR2专属` });

    const hr1List = await listProjects(hr1);
    const hr1Names = hr1List.map((p) => p.name);
    expect(hr1Names).toContain(`${NAME_PREFIX}HR1专属`);
    expect(hr1Names).not.toContain(`${NAME_PREFIX}HR2专属`);

    const adminList = await listProjects(admin);
    const adminNames = adminList.map((p) => p.name);
    expect(adminNames).toContain(`${NAME_PREFIX}HR1专属`);
    expect(adminNames).toContain(`${NAME_PREFIX}HR2专属`);

    // 普通员工（未管理任何项目）看不到任何项目
    const empList = await listProjects(emp);
    expect(empList).toHaveLength(0);

    // createProject 传 mine 变量仅为可读性
    void mine;
  });

  it("项目详情权限：非项目管理员 403，不存在的项目 404", async () => {
    const project = await createProject(hr1, {
      name: `${NAME_PREFIX}权限测试`,
    });
    await expectApiError(() => getProject(project.id, emp), 403);
    await expectApiError(() => getProject("nonexistent-id", hr1), 404);
    // 系管理员天然有权限
    const detail = await getProject(project.id, admin);
    expect(detail.project.id).toBe(project.id);
  });

  it("发布校验：缺时间、时间倒置、权重≠100 均拒绝；合法发布进入 PUBLISHED", async () => {
    const noTime = await createProject(hr1, { name: `${NAME_PREFIX}无时间` });
    await expectApiError(() => publishProject(noTime.id, hr1), 400);

    // 时间倒置在创建/更新时即被拦截
    await expectApiError(
      () =>
        createProject(hr1, {
          name: `${NAME_PREFIX}时间倒置`,
          startAt: iso(2 * HOUR),
          endAt: iso(1 * HOUR),
        }),
      400,
    );

    const badWeights = await createProject(hr1, {
      name: `${NAME_PREFIX}权重错误`,
      startAt: iso(1 * HOUR),
      endAt: iso(48 * HOUR),
      managerWeight: 50,
      peerWeight: 30,
      subordinateWeight: 30,
    });
    await expectApiError(() => publishProject(badWeights.id, hr1), 400);
    expect((await getProject(badWeights.id, hr1)).project.status).toBe("DRAFT");

    const ok = await createProject(hr1, {
      name: `${NAME_PREFIX}待发布`,
      startAt: iso(1 * HOUR), // 未来开始
      endAt: iso(48 * HOUR),
    });
    const published = await publishProject(ok.id, hr1);
    expect(published.status).toBe("PUBLISHED");

    // 重复发布 → 409
    await expectApiError(() => publishProject(ok.id, hr1), 409);
  });

  it("惰性状态同步：过开始时间 PUBLISHED→ACTIVE，过截止时间 ACTIVE→CLOSED", async () => {
    const project = await createProject(hr1, {
      name: `${NAME_PREFIX}惰性同步`,
      startAt: iso(-2 * HOUR), // 已过开始时间
      endAt: iso(48 * HOUR),
    });
    const published = await publishProject(project.id, hr1);
    expect(published.status).toBe("ACTIVE"); // 发布时已过开始时间直接 ACTIVE

    const endingSoon = await createProject(hr1, {
      name: `${NAME_PREFIX}即将截止`,
      startAt: iso(-2 * HOUR),
      endAt: iso(-1 * HOUR), // 已过截止时间
    });
    await publishProject(endingSoon.id, hr1);
    const afterSync = await getProject(endingSoon.id, hr1);
    expect(afterSync.project.status).toBe("CLOSED");
  });

  it("时间操作：ACTIVE 只能延长截止；CLOSED 设未来时间重新开放", async () => {
    const project = await createProject(hr1, {
      name: `${NAME_PREFIX}时间操作`,
      startAt: iso(-1 * HOUR),
      endAt: iso(48 * HOUR),
    });
    await publishProject(project.id, hr1);

    // ACTIVE 下改名称 → 409（只能改 endAt）
    await expectApiError(
      () => updateProject(project.id, hr1, { name: "改名" }),
      409,
    );

    // 延长截止：新时间必须晚于原截止
    await expectApiError(
      () => updateProject(project.id, hr1, { endAt: iso(24 * HOUR) }),
      400,
    );
    const extendedAt = iso(72 * HOUR);
    const extended = await updateProject(project.id, hr1, {
      endAt: extendedAt,
    });
    expect(extended.endAt).toBe(extendedAt);

    // 提前结束 → CLOSED，endAt 变为当前时刻
    const closed = await closeProject(project.id, hr1);
    expect(closed.status).toBe("CLOSED");
    expect(new Date(closed.endAt!).getTime()).toBeGreaterThan(
      Date.now() - HOUR,
    );

    // 重新开放：CLOSED 下设置未来截止时间 → ACTIVE
    const reopened = await updateProject(project.id, hr1, {
      endAt: iso(72 * HOUR),
    });
    expect(reopened.status).toBe("ACTIVE");

    // FROZEN 后不可编辑
    await closeProject(project.id, hr1);
    await freezeProject(project.id, hr1);
    await expectApiError(
      () => updateProject(project.id, hr1, { endAt: iso(96 * HOUR) }),
      409,
    );
  });

  it("冻结/解冻/归档：HR 可冻结，仅系统管理员可解冻，冻结后可归档", async () => {
    const project = await createProject(hr1, {
      name: `${NAME_PREFIX}冻结流程`,
      startAt: iso(-2 * HOUR),
      endAt: iso(-1 * HOUR),
    });
    await publishProject(project.id, hr1);
    expect((await getProject(project.id, hr1)).project.status).toBe("CLOSED");

    // 只有 CLOSED 才能冻结
    const notClosed = await createProject(hr1, {
      name: `${NAME_PREFIX}未截止冻结`,
    });
    await expectApiError(() => freezeProject(notClosed.id, hr1), 409);

    const frozen = await freezeProject(project.id, hr1);
    expect(frozen.status).toBe("FROZEN");
    expect(frozen.frozenAt).not.toBeNull();

    // HR 不能解冻
    await expectApiError(() => unfreezeProject(project.id, hr1), 403);
    // 系统管理员解冻 → CLOSED
    const unfrozen = await unfreezeProject(project.id, admin);
    expect(unfrozen.status).toBe("CLOSED");
    expect(unfrozen.frozenAt).toBeNull();

    // 再次冻结后归档
    await freezeProject(project.id, hr1);
    const archived = await archiveProject(project.id, hr1);
    expect(archived.status).toBe("ARCHIVED");
    // 归档后归档 → 409
    await expectApiError(() => archiveProject(project.id, hr1), 409);
  });

  it("项目管理员配置：按工号添加，不存在 404，重复 409，不能移除最后一个", async () => {
    const project = await createProject(hr1, {
      name: `${NAME_PREFIX}管理员配置`,
    });

    await expectApiError(
      () => addAdmin(project.id, hr1, "no-such-employee"),
      404,
    );
    const added = await addAdmin(project.id, hr1, HR2_NO);
    expect(added.employeeNo).toBe(HR2_NO);
    await expectApiError(() => addAdmin(project.id, hr1, HR2_NO), 409);

    // HR2 现在可以查看项目
    const detail = await getProject(project.id, hr2);
    expect(detail.admins).toHaveLength(2);

    // 不能移除最后一个管理员（先移除 HR2，剩 HR1）
    await removeAdmin(project.id, hr1, added.id);
    await expectApiError(
      () => removeAdmin(project.id, hr1, detail.admins[0].id),
      409,
    );
  });

  it("评分档位：只能改 label，不能跨项目改档位", async () => {
    const project = await createProject(hr1, {
      name: `${NAME_PREFIX}档位测试`,
    });
    const other = await createProject(hr2, { name: `${NAME_PREFIX}档位他人` });
    const { scales } = await getProject(project.id, hr1);

    // 用 other 项目的档位 id → 404（防跨项目篡改）
    const otherScales = (await getProject(other.id, hr2)).scales;
    await expectApiError(
      () =>
        updateScaleLabels(project.id, hr1, [
          { id: otherScales[0].id, label: "篡改" },
        ]),
      404,
    );

    const updated = await updateScaleLabels(project.id, hr1, [
      { id: scales[0].id, label: "完全没做到" },
    ]);
    expect(updated[0].label).toBe("完全没做到");
    expect(updated[0].value).toBe(scales[0].value); // value 不变

    // 非管理员不能改
    await expectApiError(
      () =>
        updateScaleLabels(project.id, emp, [{ id: scales[1].id, label: "x" }]),
      403,
    );
  });

  it("软删除：仅系统管理员；删除后列表/详情不可见", async () => {
    const project = await createProject(hr1, { name: `${NAME_PREFIX}待删除` });

    // HR 不能删除
    await expectApiError(() => deleteProject(project.id, hr1), 403);

    await deleteProject(project.id, admin);

    await expectApiError(() => getProject(project.id, hr1), 404);
    const list = await listProjects(hr1);
    expect(list.map((p) => p.id)).not.toContain(project.id);

    // 数据库中仍存在（软删除）
    const row = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(row.status).toBe("DELETED");
    expect(row.deletedAt).not.toBeNull();
    expect(row.purgeAfter).not.toBeNull();
  });
});
