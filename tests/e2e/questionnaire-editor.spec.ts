import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Sprint 12 E2E：在线问卷编辑器（PRD 第 12.1 / 11.1 节）。
 * 自动保存往返、撤销回滚、维度级适用关系、实时校验提示。
 * 在 chromium + mobile 两个工程上各跑一遍。
 */

const HR = { employeeNo: "e2e-s12-hr", name: "E2E问卷编辑HR" };

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function mockLogin(page: Page, employeeNo: string, name: string) {
  await page.goto("/login");
  await page.getByLabel("工号").fill(employeeNo);
  await page.getByLabel("姓名").fill(name);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("/");
}

/** API 建项目（DRAFT 可编辑）+ 导入官方问卷模板 */
async function setupProject(page: Page): Promise<string> {
  const created = await page.request.post("/api/projects", {
    data: {
      name: `E2E-S12-在线编辑-${Date.now()}`,
      startAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      endAt: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } })
    .project.id;

  const templateRes = await page.request.get(
    `/api/projects/${projectId}/questionnaire/template`,
  );
  expect(templateRes.ok()).toBeTruthy();
  const imported = await page.request.post(
    `/api/projects/${projectId}/questionnaire/import`,
    {
      multipart: {
        file: {
          name: "questionnaire.xlsx",
          mimeType: XLSX_MIME,
          buffer: Buffer.from(await templateRes.body()),
        },
      },
    },
  );
  expect(imported.ok()).toBeTruthy();
  return projectId;
}

/** 用鼠标事件模拟拖拽（dnd-kit MouseSensor 需移动超过 4px 才激活） */
async function dragTo(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("拖拽源或目标不可见");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 20,
  });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 2, {
    steps: 5,
  });
  await page.mouse.up();
}

test("拖拽排序：题目同维度换序 + 跨维度移动，均自动保存落库", async ({
  page,
}, testInfo) => {
  // 拖拽用鼠标事件模拟；移动端工程为触摸模拟，TouchSensor 需真实触点（Playwright 无拖拽手势 API），
  // 故移动端拖拽仅在 chromium 工程验证（真实手机由 TouchSensor 长按 200ms 激活）
  test.skip(
    testInfo.project.name !== "chromium",
    "拖拽手势模拟仅在 chromium 视口运行",
  );

  await mockLogin(page, HR.employeeNo, HR.name);
  const projectId = await setupProject(page);

  // 用短问卷（两个维度各一题）便于两个维度同时处于视口内，拖拽更稳定
  const put = await page.request.put(
    `/api/projects/${projectId}/questionnaire`,
    {
      data: {
        dimensions: [
          {
            key: "d1",
            parentKey: null,
            name: "维度甲",
            description: null,
            weight: 50,
            order: 0,
            applicable: {
              self: true,
              manager: true,
              peer: true,
              subordinate: true,
            },
          },
          {
            key: "d2",
            parentKey: null,
            name: "维度乙",
            description: null,
            weight: 50,
            order: 1,
            applicable: {
              self: true,
              manager: true,
              peer: true,
              subordinate: true,
            },
          },
        ],
        questions: [
          {
            dimensionKey: "d1",
            code: "QA1",
            type: "RATING",
            title: "甲题一",
            description: null,
            weight: 100,
            required: true,
            order: 0,
            overrideRelationRules: false,
            applicable: {
              self: true,
              manager: true,
              peer: true,
              subordinate: true,
            },
          },
          {
            dimensionKey: "d2",
            code: "QB1",
            type: "RATING",
            title: "乙题一",
            description: null,
            weight: 100,
            required: true,
            order: 0,
            overrideRelationRules: false,
            applicable: {
              self: true,
              manager: true,
              peer: true,
              subordinate: true,
            },
          },
        ],
      },
    },
  );
  expect(put.ok()).toBeTruthy();

  await page.goto(`/projects/${projectId}/questionnaire?view=edit`);
  await expect(
    page.getByRole("heading", { name: "在线编辑问卷" }),
  ).toBeVisible();

  /** 从服务端读取某维度下的题目编号顺序（避免依赖 DOM 细节） */
  const codesIn = async (dimName: string) => {
    const res = await page.request.get(
      `/api/projects/${projectId}/questionnaire`,
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      questionnaire: {
        dimensions: Array<{
          name: string;
          questions: Array<{ code: string }>;
          children: Array<{ name: string; questions: Array<{ code: string }> }>;
        }>;
      };
    };
    const top = body.questionnaire.dimensions;
    const dim =
      top.find((d) => d.name === dimName) ??
      top.flatMap((d) => d.children).find((c) => c.name === dimName);
    if (!dim) throw new Error(`未找到维度 ${dimName}`);
    return dim.questions.map((q) => q.code);
  };

  expect(await codesIn("维度甲")).toEqual(["QA1"]);
  expect(await codesIn("维度乙")).toEqual(["QB1"]);

  // --- 跨维度移动：把 QA1 拖到维度乙的题目区域 ---
  await dragTo(
    page,
    page.getByTestId("drag-QA1"),
    page.getByTestId("questions-维度乙"),
  );
  await expect(page.getByTestId("save-status")).toContainText("已自动保存", {
    timeout: 15_000,
  });
  expect(await codesIn("维度甲")).toEqual([]);
  expect(await codesIn("维度乙")).toEqual(["QA1", "QB1"]);
  // 两题权重合计 200%，编辑器应提示需要重新分配
  await expect(page.getByTestId("validation-errors")).toBeVisible();

  // --- 同维度换序：把 QB1 拖到 QA1 之前 ---
  await dragTo(
    page,
    page.getByTestId("drag-QB1"),
    page.getByTestId("drag-QA1"),
  );
  await expect(page.getByTestId("save-status")).toContainText("已自动保存", {
    timeout: 15_000,
  });
  expect(await codesIn("维度乙")).toEqual(["QB1", "QA1"]);
});

test("在线编辑：适用关系自动保存 + 撤销回滚 + 新增题目触发校验提示", async ({
  page,
}) => {
  await mockLogin(page, HR.employeeNo, HR.name);
  const projectId = await setupProject(page);

  await page.goto(`/projects/${projectId}/questionnaire?view=edit`);
  await expect(
    page.getByRole("heading", { name: "在线编辑问卷" }),
  ).toBeVisible();
  // 导入的模板本身完整
  await expect(page.getByTestId("validation-ok")).toBeVisible();

  const teamBlock = page.getByTestId("dimension-团队管理");
  const selfCheckbox = teamBlock.getByRole("checkbox", { name: "自评" });
  await expect(selfCheckbox).toBeChecked();

  // --- 维度级适用关系（PRD 11.1）：取消「团队管理」的自评 → 自动保存 ---
  await selfCheckbox.uncheck();
  await expect(page.getByTestId("save-status")).toContainText("已自动保存", {
    timeout: 15_000,
  });

  // 通过 API 确认「取消自评」已落库（不刷新页面，保留撤销历史）
  const readSelfApplicable = async () => {
    const res = await page.request.get(
      `/api/projects/${projectId}/questionnaire`,
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      questionnaire: {
        dimensions: Array<{ name: string; applicableSelf: boolean }>;
      };
    };
    return body.questionnaire.dimensions.find((d) => d.name === "团队管理")!
      .applicableSelf;
  };
  expect(await readSelfApplicable()).toBe(false);

  // --- 撤销（同一会话内，历史在内存中）：恢复勾选并再次落库 ---
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(
    page
      .getByTestId("dimension-团队管理")
      .getByRole("checkbox", { name: "自评" }),
  ).toBeChecked();
  await expect(page.getByTestId("save-status")).toContainText("已自动保存", {
    timeout: 15_000,
  });
  expect(await readSelfApplicable()).toBe(true);

  // 刷新页面：编辑器按库内数据重建，勾选状态一致
  await page.reload();
  await expect(
    page
      .getByTestId("dimension-团队管理")
      .getByRole("checkbox", { name: "自评" }),
  ).toBeChecked();

  // --- 新增题目 → 权重合计不再 100% → 出现校验提示（仍可保存）---
  await page
    .getByTestId("dimension-团队管理")
    .getByRole("button", { name: "新增题目" })
    .click();
  await expect(page.getByTestId("question-Q6")).toBeVisible();
  await expect(page.getByTestId("validation-errors")).toBeVisible();
  await expect(page.getByTestId("validation-errors")).toContainText("100%");

  // --- 删除该题 → 校验恢复通过 ---
  await page
    .getByTestId("question-Q6")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.getByTestId("question-Q6")).toHaveCount(0);
  await expect(page.getByTestId("validation-ok")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("已自动保存", {
    timeout: 15_000,
  });
});
