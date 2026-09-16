import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

/**
 * Sprint 10 E2E：
 * 1) 需求 1 —— 未冻结（测评过程中）即可查看已提交结果的实时计分；
 * 2) 需求 2 —— 用户管理的人员初始化配置（新增 / 行内编辑 / Excel 批量导入）。
 * 在 chromium + mobile 两个工程上各跑一遍。
 */

const HR = { employeeNo: "e2e-s10-hr", name: "E2E实时HR" };
const LISI = { employeeNo: "10002", name: "李四" };

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type MyTaskItem = {
  taskId: string;
  reviewee: { employeeNo: string; name: string };
  project: { id: string; name: string };
};

type TaskDetail = {
  dimensions: Array<{
    questions: Array<{ id: string; code: string }>;
    children: Array<{ questions: Array<{ id: string; code: string }> }>;
  }>;
};

async function mockLogin(page: Page, employeeNo: string, name: string) {
  await page.goto("/login");
  await page.getByLabel("工号").fill(employeeNo);
  await page.getByLabel("姓名").fill(name);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("/");
}

/** HR 通过 API 搭建一个 ACTIVE 项目（问卷 + 关系用官方模板导入并发布） */
async function setupActiveProject(page: Page): Promise<{ id: string }> {
  const created = await page.request.post("/api/projects", {
    data: {
      name: `E2E-S10-实时结果-${Date.now()}`,
      startAt: new Date(Date.now() - 3600_000).toISOString(),
      endAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } })
    .project.id;

  for (const kind of ["questionnaire", "relations"] as const) {
    const templateRes = await page.request.get(
      kind === "questionnaire"
        ? `/api/projects/${projectId}/questionnaire/template`
        : `/api/projects/${projectId}/relations/template`,
    );
    expect(templateRes.ok()).toBeTruthy();
    const imported = await page.request.post(
      kind === "questionnaire"
        ? `/api/projects/${projectId}/questionnaire/import`
        : `/api/projects/${projectId}/relations/import/commit`,
      {
        multipart: {
          file: {
            name: `${kind}.xlsx`,
            mimeType: XLSX_MIME,
            buffer: Buffer.from(await templateRes.body()),
          },
        },
      },
    );
    expect(imported.ok(), `${kind} import failed`).toBeTruthy();
  }

  const published = await page.request.post(
    `/api/projects/${projectId}/publish`,
  );
  expect(published.ok()).toBeTruthy();
  return { id: projectId };
}

/** 以当前登录身份通过 API 提交一份评价（全部量表题打同一分） */
async function submitViaApi(
  page: Page,
  projectId: string,
  revieweeNo: string,
  score: number,
) {
  const tasksRes = await page.request.get("/api/my/tasks");
  expect(tasksRes.ok()).toBeTruthy();
  const my = (await tasksRes.json()) as {
    groups: Array<{ tasks: MyTaskItem[] }>;
  };
  const task = my.groups
    .flatMap((g) => g.tasks)
    .find(
      (t) => t.project.id === projectId && t.reviewee.employeeNo === revieweeNo,
    );
  expect(task, `未找到对 ${revieweeNo} 的评价任务`).toBeTruthy();

  const detailRes = await page.request.get(`/api/tasks/${task!.taskId}`);
  expect(detailRes.ok()).toBeTruthy();
  const detail = (await detailRes.json()) as TaskDetail;
  const questions = detail.dimensions.flatMap((d) => [
    ...d.questions,
    ...d.children.flatMap((c) => c.questions),
  ]);
  const answers = questions
    .filter((q) => q.code !== "Q5") // 开放题
    .map((q) => ({ questionId: q.id, score }));

  const draftRes = await page.request.put(`/api/tasks/${task!.taskId}/draft`, {
    data: { answers },
  });
  expect(draftRes.ok()).toBeTruthy();
  const submitRes = await page.request.post(
    `/api/tasks/${task!.taskId}/submit`,
  );
  expect(submitRes.ok()).toBeTruthy();
}

test("需求1：未冻结即可查看已提交结果的实时计分", async ({ page }) => {
  // --- HR 搭建项目，李四（上级）提交对张三的评价 ---
  await mockLogin(page, HR.employeeNo, HR.name);
  const project = await setupActiveProject(page);
  await mockLogin(page, LISI.employeeNo, LISI.name);
  await submitViaApi(page, project.id, "10001", 4);

  await mockLogin(page, HR.employeeNo, HR.name);

  // --- 项目详情页：未冻结也能进入结果后台 ---
  await page.goto(`/projects/${project.id}`);
  const resultsLink = page.getByRole("link", { name: "结果后台" });
  await expect(resultsLink).toBeVisible();
  await resultsLink.click();
  await page.waitForURL(/\/results$/);

  // --- 实时数据提示 + 张三已有分数（上级 4.00 → 总分 4.00，完成 1/4）---
  await expect(page.getByText("当前为实时数据").first()).toBeVisible();
  const zhangsanRow = page.getByRole("row").filter({ hasText: "张三" });
  await expect(zhangsanRow).toContainText("4.00");
  await expect(zhangsanRow).toContainText("1/4");
  // 尚无提交的李四显示为空
  const lisiRow = page.getByRole("row").filter({ hasText: "李四" });
  await expect(lisiRow).toContainText("—");

  // --- 进度看板提供实时结果入口 ---
  await page.goto(`/projects/${project.id}/progress`);
  await expect(page.getByText("已提交结果（实时）")).toBeVisible();
  await page.getByRole("link", { name: "查看实时结果后台" }).click();
  await page.waitForURL(/\/results$/);
  await expect(page.getByRole("row").filter({ hasText: "张三" })).toContainText(
    "4.00",
  );
});

test("需求2：用户管理可新增/编辑/批量导入人员", async ({ page }) => {
  await mockLogin(page, "00000", "系统管理员");
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();

  const suffix = `${Date.now()}`.slice(-8);
  const noA = `e2e-s10-a${suffix}`;
  const noB = `e2e-s10-b${suffix}`;

  // --- 新增人员 ---
  const createForm = page.getByTestId("person-create-form");
  await createForm.getByLabel("工号").fill(noA);
  await createForm.getByLabel("姓名").fill("E2E新增人员");
  await createForm.getByLabel("部门").fill("研发中心");
  await createForm.getByLabel("岗位").fill("后端工程师");
  await createForm.getByLabel("职级").fill("P6");
  await createForm.getByRole("button", { name: "新增", exact: true }).click();

  const rowA = page.getByRole("row").filter({ hasText: noA });
  await expect(rowA).toContainText("E2E新增人员");
  await expect(rowA).toContainText("研发中心");
  await expect(rowA).toContainText("后端工程师");
  await expect(rowA).toContainText("P6");

  // --- 行内编辑：改部门 ---
  await rowA.getByRole("button", { name: "编辑" }).click();
  const editForm = rowA.getByTestId("person-edit-form");
  await editForm.getByLabel("部门").fill("平台技术部");
  await editForm.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("row").filter({ hasText: noA })).toContainText(
    "平台技术部",
  );

  // --- 批量导入（模板列：工号/姓名/部门/岗位/职级）---
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("人员");
  ws.addRow(["工号", "姓名", "部门", "岗位", "职级"]);
  ws.addRow([noB, "E2E批量人员", "销售部", "客户经理", "P5"]);
  ws.addRow([noA, "重复工号", "", "", ""]); // 已存在 → 跳过
  const bulkForm = page.getByTestId("person-bulk-form");
  await bulkForm.locator('input[type="file"]').setInputFiles({
    name: "people.xlsx",
    mimeType: XLSX_MIME,
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await bulkForm.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByText(/导入完成：新增 1 人，跳过 1 行/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: noB })).toContainText(
    "销售部",
  );
});
