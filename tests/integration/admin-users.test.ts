import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * 人员初始化配置（Sprint 10 需求 2）集成测试：
 * 直接调用 Route Handler（系统管理员身份由 getCurrentUser mock 提供），
 * 覆盖新增 / 编辑 / 批量导入 / 工号唯一 / 权限拦截。
 */

vi.mock("@/modules/auth/service", () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from "@/modules/auth/service";
import {
  GET as listUsers,
  POST as createUser,
} from "@/app/api/admin/users/route";
import { PATCH as patchUser } from "@/app/api/admin/users/[id]/route";
import { POST as bulkImport } from "@/app/api/admin/users/bulk/route";

const mockedGetCurrentUser = vi.mocked(getCurrentUser);

/** 以指定身份调用 Route Handler（handler 只用到 req.json/formData，Request 足够） */
function call(
  handler: (req: never, ctx: never) => Promise<Response>,
  req: Request,
  ctx?: unknown,
): Promise<Response> {
  return handler(req as never, (ctx ?? {}) as never);
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 生成人员导入 Excel（列：工号/姓名/部门/岗位/职级） */
async function peopleWorkbook(
  rows: Array<Array<string | null>>,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("人员");
  ws.addRow(["工号", "姓名", "部门", "岗位", "职级"]);
  for (const row of rows) ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf]);
}

describe.skipIf(!process.env.DATABASE_URL)(
  "人员初始化配置（Sprint 10）",
  () => {
    const PREFIX = "it-s10-";
    const SUFFIX = String(Date.now()).slice(-6);
    const NO_A = `${PREFIX}a${SUFFIX}`;
    const NO_B = `${PREFIX}b${SUFFIX}`;
    const NO_C = `${PREFIX}c${SUFFIX}`;
    const NO_D = `${PREFIX}d${SUFFIX}`;
    const allNos = [NO_A, NO_B, NO_C, NO_D];

    let admin: User;
    let normalUser: User;

    beforeAll(async () => {
      admin = await prisma.user.upsert({
        where: { employeeNo: `${PREFIX}admin` },
        update: { systemRole: "SYSTEM_ADMIN" },
        create: {
          employeeNo: `${PREFIX}admin`,
          name: "集成测试S10管理员",
          systemRole: "SYSTEM_ADMIN",
        },
      });
      normalUser = await prisma.user.upsert({
        where: { employeeNo: `${PREFIX}user` },
        update: { systemRole: "USER" },
        create: {
          employeeNo: `${PREFIX}user`,
          name: "集成测试S10普通用户",
          systemRole: "USER",
        },
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({
        where: {
          employeeNo: { in: [...allNos, `${PREFIX}admin`, `${PREFIX}user`] },
        },
      });
    });

    it("非系统管理员：新增 403", async () => {
      mockedGetCurrentUser.mockResolvedValue(normalUser);
      const res = await call(
        createUser,
        jsonRequest("http://t/api/admin/users", "POST", {
          employeeNo: NO_A,
          name: "张三",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("新增人员：201 落库（含部门/岗位/职级）", async () => {
      mockedGetCurrentUser.mockResolvedValue(admin);
      const res = await call(
        createUser,
        jsonRequest("http://t/api/admin/users", "POST", {
          employeeNo: NO_A,
          name: "张三",
          department: "研发中心",
          position: "后端工程师",
          grade: "P6",
        }),
      );
      expect(res.status).toBe(201);
      const data = (await res.json()) as { user: { id: string } };
      const row = await prisma.user.findUnique({ where: { id: data.user.id } });
      expect(row?.department).toBe("研发中心");
      expect(row?.position).toBe("后端工程师");
      expect(row?.grade).toBe("P6");
      expect(row?.systemRole).toBe("USER");
    });

    it("新增人员：缺少工号/姓名 400，工号重复 409", async () => {
      mockedGetCurrentUser.mockResolvedValue(admin);
      const missing = await call(
        createUser,
        jsonRequest("http://t/api/admin/users", "POST", { name: "无工号" }),
      );
      expect(missing.status).toBe(400);

      const dup = await call(
        createUser,
        jsonRequest("http://t/api/admin/users", "POST", {
          employeeNo: NO_A,
          name: "重复工号",
        }),
      );
      expect(dup.status).toBe(409);
    });

    it("编辑人员：PATCH 更新姓名/部门/岗位/职级（空串清空为 null）", async () => {
      mockedGetCurrentUser.mockResolvedValue(admin);
      const target = await prisma.user.findUnique({
        where: { employeeNo: NO_A },
      });
      const res = await call(
        patchUser,
        jsonRequest(`http://t/api/admin/users/${target!.id}`, "PATCH", {
          name: "张三丰",
          department: "平台部",
          position: "",
          grade: "P7",
        }),
        { params: Promise.resolve({ id: target!.id }) },
      );
      expect(res.status).toBe(200);
      const row = await prisma.user.findUnique({ where: { id: target!.id } });
      expect(row?.name).toBe("张三丰");
      expect(row?.department).toBe("平台部");
      expect(row?.position).toBeNull();
      expect(row?.grade).toBe("P7");
    });

    it("编辑人员：不能修改自己的系统管理员角色（400）", async () => {
      mockedGetCurrentUser.mockResolvedValue(admin);
      const res = await call(
        patchUser,
        jsonRequest(`http://t/api/admin/users/${admin.id}`, "PATCH", {
          systemRole: "USER",
        }),
        { params: Promise.resolve({ id: admin.id }) },
      );
      expect(res.status).toBe(400);
      const row = await prisma.user.findUnique({ where: { id: admin.id } });
      expect(row?.systemRole).toBe("SYSTEM_ADMIN");
    });

    it("列表：包含新字段 department/position/grade", async () => {
      mockedGetCurrentUser.mockResolvedValue(admin);
      const res = await call(
        listUsers,
        new Request("http://t/api/admin/users"),
      );
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{
        employeeNo: string | null;
        department: string | null;
        grade: string | null;
      }>;
      const row = list.find((u) => u.employeeNo === NO_A);
      expect(row?.department).toBe("平台部");
      expect(row?.grade).toBe("P7");
    });

    it("批量导入：新增有效行，跳过重复/缺字段行并回报行号", async () => {
      mockedGetCurrentUser.mockResolvedValue(admin);
      const blob = await peopleWorkbook([
        [NO_B, "李四", "销售部", "客户经理", "P5"],
        [NO_C, "王五", "财务部", "", "P4"],
        ["", "缺工号", "未知", "", ""], // 缺工号 → 错误
        [NO_B, "表内重复", "", "", ""], // 表内重复 → 错误
        [NO_A, "已存在工号", "", "", ""], // 已存在 → 错误
        [null, null, null, null, null], // 空行 → 跳过
      ]);
      const fd = new FormData();
      fd.append("file", blob, "people.xlsx");
      const res = await call(
        bulkImport,
        new Request("http://t/api/admin/users/bulk", {
          method: "POST",
          body: fd,
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        created: number;
        total: number;
        errors: Array<{ row: number; message: string }>;
      };
      expect(data.created).toBe(2);
      // total = 通过字段校验的行数（缺工号的行只记错误，空行直接跳过）
      expect(data.total).toBe(4);
      expect(data.errors).toHaveLength(3);
      expect(data.errors.map((e) => e.row)).toEqual([4, 5, 6]);

      const created = await prisma.user.findMany({
        where: { employeeNo: { in: [NO_B, NO_C] } },
        orderBy: { employeeNo: "asc" },
      });
      expect(created).toHaveLength(2);
      expect(created.find((u) => u.employeeNo === NO_B)?.department).toBe(
        "销售部",
      );
      // 空单元格落库为 null
      expect(created.find((u) => u.employeeNo === NO_C)?.grade).toBe("P4");
    });

    it("批量导入：无有效数据 400", async () => {
      mockedGetCurrentUser.mockResolvedValue(admin);
      const fd = new FormData();
      fd.append("file", await peopleWorkbook([]), "empty.xlsx");
      const res = await call(
        bulkImport,
        new Request("http://t/api/admin/users/bulk", {
          method: "POST",
          body: fd,
        }),
      );
      expect(res.status).toBe(400);
    });

    it("批量导入：非系统管理员 403", async () => {
      mockedGetCurrentUser.mockResolvedValue(normalUser);
      const fd = new FormData();
      fd.append(
        "file",
        await peopleWorkbook([[NO_D, "赵六", "", "", ""]]),
        "people.xlsx",
      );
      const res = await call(
        bulkImport,
        new Request("http://t/api/admin/users/bulk", {
          method: "POST",
          body: fd,
        }),
      );
      expect(res.status).toBe(403);
      expect(
        await prisma.user.findUnique({ where: { employeeNo: NO_D } }),
      ).toBeNull();
    });
  },
);
