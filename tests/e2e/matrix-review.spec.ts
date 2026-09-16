import { expect, test, type Page } from "@playwright/test";

/**
 * Sprint 6 E2E：矩阵评价模式。
 * - chromium：PC TanStack Table 矩阵表全流程（矩阵打分 → 切单人验证互通 → 回矩阵 → 批量提交）
 * - mobile：卡片流（当前维度 → 当前题目 → 人员卡片）可实际操作（禁止整表缩放）
 * HR 阶段通过 API（page.request 复用登录态）准备数据。
 */

const HR = { employeeNo: "e2e-s6-hr", name: "E2E矩阵HR" };
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
  // 随机后缀防并行工程（chromium/mobile）毫秒级时间戳重名
  const projectName = `E2E-S6-矩阵项目-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

/** 多项目遗留数据时切换到本项目 tab（单项目时无 tab，跳过） */
async function selectProjectTab(page: Page, projectName: string) {
  const tab = page.getByRole("button", { name: projectName, exact: true });
  if ((await tab.count()) > 0) {
    await tab.click();
  }
}

function matrixCell(page: Page, employeeNo: string, code: string) {
  return page.getByTestId(`cell-${employeeNo}-${code}`);
}

/** 在当前维度下给指定被评人填所有可见量表题（跨维度由调用方遍历维度 tab） */
async function fillVisibleRatings(page: Page, employeeNo: string) {
  for (const code of ["Q1", "Q2", "Q3", "Q4"]) {
    const cell = matrixCell(page, employeeNo, code);
    if ((await cell.count()) > 0) {
      await cell.getByRole("button", { name: /^4\.5/ }).click();
    }
  }
}

/** 遍历全部维度 tab，把指定被评人的量表题全部填为 4.5 */
async function fillAllDimensions(page: Page, employeeNo: string) {
  const dimTabs = page.locator('[aria-label="维度"]').getByRole("button");
  const count = await dimTabs.count();
  for (let i = 0; i < count; i++) {
    await dimTabs.nth(i).click();
    await fillVisibleRatings(page, employeeNo);
  }
}

test("PC 矩阵：打分 → 切单人（数据互通）→ 回矩阵 → 批量提交", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "PC 矩阵表流程仅在 chromium 视口运行",
  );

  await mockLogin(page, HR.employeeNo, HR.name);
  const project = await setupActiveProject(page);

  // --- 任务列表 → 平级矩阵入口 ---
  await mockLogin(page, REVIEWER.employeeNo, REVIEWER.name);
  await page.goto("/review");
  await page.getByTestId("matrix-entry-PEER").click();
  await page.waitForURL(/\/review\/matrix/);
  await selectProjectTab(page, project.name);

  // --- 矩阵表：张三/李四两行 ---
  const table = page.getByTestId("matrix-table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("button", { name: "张三" })).toBeVisible();
  await expect(table.getByRole("button", { name: "李四" })).toBeVisible();
  await expect(matrixCell(page, "10001", "Q5")).toHaveCount(0); // 平级不适用 Q5

  // --- 张三 Q1 打 4.5 → 等自动保存 ---
  await matrixCell(page, "10001", "Q1")
    .getByRole("button", { name: /^4\.5/ })
    .click();
  await expect(page.getByTestId("save-status-pc")).toHaveText(/已自动保存/, {
    timeout: 10_000,
  });

  // --- 切单人模式：张三 Q1 = 4.5（矩阵 → 单人数据互通）---
  await table.getByRole("button", { name: "张三" }).click();
  await page.waitForURL(/\/review\/[^/]+$/);
  await expect(
    page.getByTestId("rating-Q1").getByRole("button", { name: /^4\.5/ }),
  ).toHaveAttribute("aria-pressed", "true");

  // --- 单人 → 切回矩阵：数据完整 ---
  await page.getByTestId("switch-to-matrix").click();
  await page.waitForURL(/\/review\/matrix/);
  await selectProjectTab(page, project.name);
  await expect(
    matrixCell(page, "10001", "Q1").getByRole("button", { name: /^4\.5/ }),
  ).toHaveAttribute("aria-pressed", "true");

  // --- 填完张三、李四全部量表题（遍历维度 tab）---
  await fillAllDimensions(page, "10001");
  await fillAllDimensions(page, "10002");
  await expect(page.getByTestId("save-status-pc")).toHaveText(/已自动保存/, {
    timeout: 10_000,
  });

  // --- 批量提交：成功 2 份，状态变已完成 ---
  await page.getByTestId("batch-submit").click();
  await expect(page.getByTestId("batch-result")).toBeVisible();
  await expect(page.getByText("批量提交完成：成功 2 份")).toBeVisible();
  await expect(table.getByText("已完成")).toHaveCount(2, { timeout: 10_000 });
});

test("移动端矩阵：维度 → 题目 → 人员卡片流填写并批量提交", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "移动卡片流仅在 mobile 视口运行",
  );

  await mockLogin(page, HR.employeeNo, HR.name);
  const project = await setupActiveProject(page);

  // --- 直接进入平级矩阵 ---
  await mockLogin(page, REVIEWER.employeeNo, REVIEWER.name);
  await page.goto("/review/matrix?relation=PEER");
  await selectProjectTab(page, project.name);

  const cards = page.getByTestId("matrix-cards");
  await expect(cards).toBeVisible();
  await expect(page.getByTestId("matrix-table")).toBeHidden(); // 禁止整表缩放

  // --- 遍历维度 × 题目，给张三/李四卡片打分 ---
  const dimTabs = page.locator('[aria-label="维度"]').getByRole("button");
  const dimCount = await dimTabs.count();
  for (let i = 0; i < dimCount; i++) {
    await dimTabs.nth(i).click();
    const questionSelect = page.getByTestId("question-select");
    // 当前维度的题目数量（切维度后题目自动回到第一题）
    const questionCount = await questionSelect.locator("option").count();
    for (let qi = 0; qi < questionCount; qi++) {
      await questionSelect.selectOption({ index: qi });
      await cards
        .locator('[data-person="10001"] [data-testid^="rating-"]')
        .getByRole("button", { name: /^4\.5/ })
        .click();
      await cards
        .locator('[data-person="10002"] [data-testid^="rating-"]')
        .getByRole("button", { name: /^4\.0/ })
        .click();
    }
  }
  await expect(page.getByTestId("save-status-mobile")).toHaveText(
    /已自动保存/,
    { timeout: 10_000 },
  );

  // --- 批量提交（吸底按钮）---
  await page.getByTestId("batch-submit-mobile").click();
  await expect(page.getByTestId("batch-result")).toBeVisible();
  await expect(page.getByText("批量提交完成：成功 2 份")).toBeVisible();
});
