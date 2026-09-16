import { expect, test, type Page } from "@playwright/test";

/**
 * Sprint 8 E2E：进度看板 → 冻结 → 结果后台 → 下钻 → 实名明细 → 解冻权限。
 * 评价人通过 API 提交（复用登录态），HR 在页面上完成冻结与查看。
 * 在 chromium + mobile 两个工程上各跑一遍。
 */

const HR = { employeeNo: "e2e-s8-hr", name: "E2E结果HR" };
const ZHANGSAN = { employeeNo: "10001", name: "张三" };
const LISI = { employeeNo: "10002", name: "李四" };
const WANGWU = { employeeNo: "10003", name: "王五" };

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

/** HR 通过 API 搭建一个 ACTIVE 项目（问卷 + 关系用官方模板导入） */
async function setupActiveProject(page: Page): Promise<{ id: string }> {
  const created = await page.request.post("/api/projects", {
    data: {
      name: `E2E-S8-结果项目-${Date.now()}`,
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

/** 以当前登录身份通过 API 提交一份评价（量表分 + 可选文本） */
async function submitViaApi(
  page: Page,
  projectId: string,
  revieweeNo: string,
  ratings: Record<string, number>,
  texts: Record<string, string> = {},
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

  const answers: Array<
    | { questionId: string; score: number }
    | { questionId: string; textValue: string }
  > = [];
  for (const [code, score] of Object.entries(ratings)) {
    answers.push({
      questionId: questions.find((q) => q.code === code)!.id,
      score,
    });
  }
  for (const [code, textValue] of Object.entries(texts)) {
    answers.push({
      questionId: questions.find((q) => q.code === code)!.id,
      textValue,
    });
  }
  const draftRes = await page.request.put(`/api/tasks/${task!.taskId}/draft`, {
    data: { answers },
  });
  expect(draftRes.ok()).toBeTruthy();
  const submitRes = await page.request.post(
    `/api/tasks/${task!.taskId}/submit`,
  );
  expect(submitRes.ok()).toBeTruthy();
}

test("进度看板 → 冻结 → 结果后台 → 下钻 → 实名明细 → 解冻权限", async ({
  page,
}) => {
  // --- HR 搭建项目 ---
  await mockLogin(page, HR.employeeNo, HR.name);
  const project = await setupActiveProject(page);

  // --- 三位评价人通过 API 提交（王五评李四/李四自评/赵六下级评张三不提交）---
  await mockLogin(page, ZHANGSAN.employeeNo, ZHANGSAN.name);
  await submitViaApi(page, project.id, "10001", { Q1: 3, Q2: 3, Q3: 3, Q4: 3 });
  await mockLogin(page, LISI.employeeNo, LISI.name);
  await submitViaApi(
    page,
    project.id,
    "10001",
    { Q1: 4, Q2: 4, Q3: 4, Q4: 4 },
    { Q5: "上级开放反馈：继续保持" },
  );
  await mockLogin(page, WANGWU.employeeNo, WANGWU.name);
  await submitViaApi(page, project.id, "10001", { Q1: 5, Q2: 5, Q3: 5, Q4: 5 });

  // --- HR 提前结束项目，进入进度看板 ---
  await mockLogin(page, HR.employeeNo, HR.name);
  const closed = await page.request.post(`/api/projects/${project.id}/close`);
  expect(closed.ok()).toBeTruthy();

  await page.goto(`/projects/${project.id}/progress`);
  await expect(page.getByText("项目总体")).toBeVisible();
  await expect(page.getByText("应完成 6 份 · 已完成 3 份")).toBeVisible();

  // 完整性警告（PRD 第 36 节）：未 100% 完成
  const warning = page.getByTestId("completeness-warning");
  await expect(warning).toBeVisible();
  await expect(warning.getByText("应评价 6 份 · 实际评价 3 份")).toBeVisible();
  await expect(warning.getByText(/1 人未完成自评（李四）/)).toBeVisible();

  // 按评价人视图：催办剩余
  await page.getByRole("tab", { name: /按评价人/ }).click();
  await expect(page.getByText("赵六").first()).toBeVisible();
  const zhaoliuRow = page.getByRole("row").filter({ hasText: "赵六" });
  await expect(zhaoliuRow).toContainText("1");

  // --- 冻结（confirm 弹窗确认，含完整性提示）---
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("应完成 6 份 / 已完成 3 份");
    expect(dialog.message()).toContain("结果完整性不足");
    void dialog.accept();
  });
  await page.getByRole("button", { name: "冻结结果" }).click();

  // 冻结成功：正式结果卡片出现，警告消失
  await expect(page.getByText("正式结果")).toBeVisible();
  await expect(page.getByText("查看结果后台")).toBeVisible();
  await expect(warning).toHaveCount(0);

  // --- 结果后台：快照数值（张三 4.43 = (4×40+5×30)/70，完成率 3/4）---
  await page.getByRole("link", { name: "查看结果后台" }).click();
  await page.waitForURL(/\/results$/);
  const zhangsanRow = page.getByRole("row").filter({ hasText: "张三" });
  await expect(zhangsanRow).toContainText("4.43");
  await expect(zhangsanRow).toContainText("3/4");
  await expect(zhangsanRow).toContainText("75.00%");
  const lisiRow = page.getByRole("row").filter({ hasText: "李四" });
  await expect(lisiRow).toContainText("—");

  // --- 下钻：得分卡片 + 维度树 + 实名明细 ---
  await zhangsanRow.getByRole("link", { name: "查看下钻" }).click();
  await page.waitForURL(/\/results\/[^/]+$/);
  await expect(page.getByText("张三 的测评结果")).toBeVisible();
  await expect(
    page.getByText("结果完整性不足：应评 4 份，实际 3 份"),
  ).toBeVisible();

  // 上级维度树：团队管理 60% → 4.00（题目 Q1/Q2 直挂）
  const managerSection = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("上级得分") });
  await expect(managerSection).toContainText("4.00");
  await expect(managerSection).toContainText("团队管理");

  // 实名明细（仅 HR 端）：李四（上级）的开放题原文
  await page.getByTestId("reviewer-detail-1").locator("summary").click();
  await expect(
    page.getByTestId("reviewer-detail-1").getByText("上级开放反馈：继续保持"),
  ).toBeVisible();

  // --- 解冻权限：HR 无权（PRD 6.3 仅系统管理员）---
  const unfreeze = await page.request.post(
    `/api/projects/${project.id}/unfreeze`,
  );
  expect(unfreeze.status()).toBe(403);
});
