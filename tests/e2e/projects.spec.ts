import { expect, test, type Page } from "@playwright/test";

/** mock 登录辅助：走真实 UI 流程 */
async function mockLogin(page: Page, employeeNo: string, name: string) {
  await page.goto("/login");
  await page.getByLabel("工号").fill(employeeNo);
  await page.getByLabel("姓名").fill(name);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("/");
}

/** 通过 UI 新建项目并进入详情页，返回项目 id */
async function createProjectViaUi(
  page: Page,
  name: string,
  opts: {
    managerWeight?: string;
    peerWeight?: string;
    subordinateWeight?: string;
  } = {},
) {
  await page.goto("/projects/new");
  await page.getByLabel("项目名称 *").fill(name);
  await page.getByLabel("开始时间").fill("2027-06-01T09:00");
  await page.getByLabel("截止时间").fill("2027-06-15T18:00");
  await page
    .getByLabel("上级", { exact: true })
    .fill(opts.managerWeight ?? "40");
  await page.getByLabel("平级", { exact: true }).fill(opts.peerWeight ?? "30");
  await page
    .getByLabel("下级", { exact: true })
    .fill(opts.subordinateWeight ?? "30");
  await page.getByRole("button", { name: "创建项目" }).click();
  // 注意排除 /projects/new 本身（当前页面 URL 也能匹配宽松正则）
  await page.waitForURL(/\/projects\/(?!new$)[^/]+$/);
  return page.url().split("/").pop()!;
}

test("未登录访问项目接口返回 401", async ({ request }) => {
  const res = await request.get("/api/projects");
  expect(res.status()).toBe(401);
});

test("HR 新建项目 → 配置 → 发布成功", async ({ page }) => {
  await mockLogin(page, "e2e-hr-001", "E2E项目管理员");
  const projectName = `E2E发布项目-${Date.now()}`;
  const projectId = await createProjectViaUi(page, projectName);

  // 详情页：草稿状态、默认 10 档档位、创建者为管理员
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
  await expect(page.getByText("评分档位（10）")).toBeVisible();
  const firstScaleInput = page
    .locator("div.contents")
    .filter({ hasText: /^0\.5$/ })
    .getByRole("textbox");
  const lastScaleInput = page
    .locator("div.contents")
    .filter({ hasText: /^5\.0$/ })
    .getByRole("textbox");
  await expect(lastScaleInput).toHaveValue("持续稳定体现");
  await expect(page.getByText("E2E项目管理员")).toBeVisible();

  // 修改档位说明
  await firstScaleInput.fill("完全没有体现");
  await page.getByRole("button", { name: "保存档位说明" }).click();
  await expect(firstScaleInput).toHaveValue("完全没有体现");

  // 导入问卷（Sprint 3 起发布的前置条件）：下载官方模板并经 API 导入
  const templateRes = await page.request.get(
    `/api/projects/${projectId}/questionnaire/template`,
  );
  expect(templateRes.ok()).toBeTruthy();
  const importRes = await page.request.post(
    `/api/projects/${projectId}/questionnaire/import`,
    {
      multipart: {
        file: {
          name: "template.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(await templateRes.body()),
        },
      },
    },
  );
  expect(importRes.ok()).toBeTruthy();

  // 发布
  await page.getByRole("button", { name: "发布项目" }).click();
  await expect(page.getByText("已发布", { exact: true })).toBeVisible();

  // 列表可见，首页出现项目管理入口
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: projectName })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "项目管理" })).toBeVisible();

  // 项目 id 后续用例复用校验权限
  void projectId;
});

test("权重合计不等于 100% 时无法发布", async ({ page }) => {
  await mockLogin(page, "e2e-hr-001", "E2E项目管理员");
  await createProjectViaUi(page, `E2E权重错误-${Date.now()}`, {
    managerWeight: "50",
    peerWeight: "30",
    subordinateWeight: "30",
  });

  await page.getByRole("button", { name: "发布项目" }).click();
  await expect(page.getByText("关系权重合计必须等于 100%")).toBeVisible();
  // 状态仍是草稿
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
});

test("非项目管理员不能访问他人项目（服务端鉴权）", async ({ page }) => {
  // HR1 创建项目
  await mockLogin(page, "e2e-hr-002", "E2E项目主人");
  const projectId = await createProjectViaUi(page, `E2E他人项目-${Date.now()}`);

  // 普通员工直接调 API → 403
  await mockLogin(page, "e2e-emp-099", "E2E路人员工");
  const apiRes = await page.request.get(`/api/projects/${projectId}`);
  expect(apiRes.status()).toBe(403);

  // 普通员工访问详情页 → 重定向回首页
  await page.goto(`/projects/${projectId}`);
  await page.waitForURL("/");
  // 首页没有项目管理入口
  await expect(page.getByRole("link", { name: "项目管理" })).toHaveCount(0);
});
