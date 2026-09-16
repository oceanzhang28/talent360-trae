import { expect, test, type Page } from "@playwright/test";

/**
 * Sprint 5 E2E：评价端单人全流程（草稿自动保存 → 刷新恢复 → 提交 → HR 退回 → 重交）。
 * 在 chromium + mobile 两个工程上各跑一遍（手机优先布局需移动视口可实际操作）。
 * HR 阶段通过 API（page.request 复用登录态）准备数据。
 */

const HR = { employeeNo: "e2e-s5-hr", name: "E2E评价HR" };
const REVIEWER = { employeeNo: "10003", name: "王五" }; // 模板自带的平级评价人

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function mockLogin(page: Page, employeeNo: string, name: string) {
  await page.goto("/login");
  await page.getByLabel("工号").fill(employeeNo);
  await page.getByLabel("姓名").fill(name);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("/");
}

/** HR 通过 API 搭建一个 ACTIVE 项目（问卷 + 关系用官方模板导入），返回项目 id 与名称 */
async function setupActiveProject(page: Page): Promise<{
  id: string;
  name: string;
}> {
  const projectName = `E2E-S5-评价项目-${Date.now()}`;
  const created = await page.request.post("/api/projects", {
    data: {
      name: projectName,
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
    const importPath =
      kind === "questionnaire"
        ? `/api/projects/${projectId}/questionnaire/import`
        : `/api/projects/${projectId}/relations/import/commit`;
    const imported = await page.request.post(importPath, {
      multipart: {
        file: {
          name: `${kind}.xlsx`,
          mimeType: XLSX_MIME,
          buffer: Buffer.from(await templateRes.body()),
        },
      },
    });
    expect(imported.ok(), `${kind} import failed`).toBeTruthy();
  }

  const published = await page.request.post(
    `/api/projects/${projectId}/publish`,
  );
  expect(published.ok()).toBeTruthy();
  return { id: projectId, name: projectName };
}

/** 打开 /review 中指定项目下某被评人的任务，返回 taskId */
async function openTask(page: Page, projectName: string, revieweeName: string) {
  await page.goto("/review");
  await page
    .getByRole("link", {
      name: new RegExp(`${revieweeName}[\\s\\S]*${projectName}`),
    })
    .click();
  await page.waitForURL(/\/review\/[^/]+$/);
  return page.url().split("/").pop()!;
}

function ratingButton(page: Page, code: string, value: string) {
  return page.getByTestId(`rating-${code}`).getByRole("button", {
    name: new RegExp(`^${value.replace(".", "\\.")}`),
  });
}

test("草稿自动保存 → 刷新恢复 → 提交 → HR 退回 → 重交新版本", async ({
  page,
}) => {
  // --- HR 搭建项目 ---
  await mockLogin(page, HR.employeeNo, HR.name);
  const project = await setupActiveProject(page);

  // --- 评价人：首页待评价入口 + 任务列表 ---
  await mockLogin(page, REVIEWER.employeeNo, REVIEWER.name);
  await expect(page.getByText(/份评价待完成/)).toBeVisible();
  await page.getByRole("link", { name: /进入评价/ }).click();
  await page.waitForURL("/review");
  await expect(page.getByRole("link", { name: /张三/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /李四/ }).first()).toBeVisible();

  // --- 打开张三的平级评价任务 ---
  const taskId = await openTask(page, project.name, "张三");
  await expect(page.getByText("团队管理", { exact: true })).toBeVisible();
  await expect(page.getByText("专业能力", { exact: true })).toBeVisible();
  // Q5（文本题，平级不适用）不应出现
  await expect(
    page.getByText("请举例说明该同事最突出的专业表现"),
  ).not.toBeVisible();

  // --- 作答 → 等自动保存（debounce 1.5s）---
  for (const code of ["Q1", "Q2", "Q3", "Q4"]) {
    await ratingButton(page, code, "4.5").click();
  }
  await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10_000 });

  // --- 刷新后草稿恢复（换设备/刷新不丢数据）---
  await page.reload();
  for (const code of ["Q1", "Q2", "Q3", "Q4"]) {
    await expect(ratingButton(page, code, "4.5")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }

  // --- 提交 → 只读横幅 ---
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByTestId("submitted-banner")).toBeVisible();
  await expect(page.getByText("已提交（第 1 版）")).toBeVisible();
  // 提交后不可再改
  await expect(ratingButton(page, "Q1", "3.0")).toBeDisabled();

  // --- HR 退回（API）---
  await mockLogin(page, HR.employeeNo, HR.name);
  const returned = await page.request.post(`/api/tasks/${taskId}/return`);
  expect(returned.ok()).toBeTruthy();

  // 铁律 4：HR 任何接口拿不到草稿内容与任务详情
  const draftRes = await page.request.get(`/api/tasks/${taskId}/draft`);
  expect(draftRes.status()).toBe(403);
  const detailRes = await page.request.get(`/api/tasks/${taskId}`);
  expect(detailRes.status()).toBe(403);

  // --- 评价人：退回横幅 → 修改 → 重交（v2）---
  await mockLogin(page, REVIEWER.employeeNo, REVIEWER.name);
  await page.goto(`/review/${taskId}`);
  await expect(page.getByTestId("returned-banner")).toBeVisible();
  await ratingButton(page, "Q1", "5.0").click();
  await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByText("已提交（第 2 版）")).toBeVisible();
});

test("必答缺失时提交被拦截并标红提示；登出后接口 401", async ({ page }) => {
  await mockLogin(page, HR.employeeNo, HR.name);
  const project = await setupActiveProject(page);
  await mockLogin(page, REVIEWER.employeeNo, REVIEWER.name);
  const taskId = await openTask(page, project.name, "李四");

  // 只答 Q1，直接提交（提交前会先把未保存草稿落库）
  await ratingButton(page, "Q1", "3.0").click();
  await page.getByRole("button", { name: "提交评价" }).click();

  await expect(page.getByTestId("submit-error")).toBeVisible();
  await expect(
    page.getByText("必答项未完成，请填写标红的题目后重试"),
  ).toBeVisible();

  // 补全后提交成功
  for (const code of ["Q2", "Q3", "Q4"]) {
    await ratingButton(page, code, "4.0").click();
  }
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByTestId("submitted-banner")).toBeVisible();

  // 登出后评价接口不可访问
  await page.request.post("/api/auth/logout");
  const res = await page.request.get(`/api/tasks/${taskId}`);
  expect(res.status()).toBe(401);
});
