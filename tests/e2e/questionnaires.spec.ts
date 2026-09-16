import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
async function createProjectViaUi(page: Page, name: string) {
  await page.goto("/projects/new");
  await page.getByLabel("项目名称 *").fill(name);
  await page.getByLabel("开始时间").fill("2027-06-01T09:00");
  await page.getByLabel("截止时间").fill("2027-06-15T18:00");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.waitForURL(/\/projects\/(?!new$)[^/]+$/);
  return page.url().split("/").pop()!;
}

test("未导入问卷时发布被拦截并提示", async ({ page }) => {
  await mockLogin(page, "e2e-s3-hr", "E2E问卷管理员");
  await createProjectViaUi(page, `E2E-S3-无问卷-${Date.now()}`);

  await page.getByRole("button", { name: "发布项目" }).click();
  await expect(
    page.getByText("发布前必须先导入问卷（至少一个维度和一道题目）"),
  ).toBeVisible();
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
});

test("下载 Excel 模板 → 导入 → 发布成功 → 预览按关系过滤", async ({ page }) => {
  await mockLogin(page, "e2e-s3-hr", "E2E问卷管理员");
  const projectId = await createProjectViaUi(
    page,
    `E2E-S3-问卷项目-${Date.now()}`,
  );

  // 通过 API 下载模板（与浏览器共享登录态），落盘后经 UI 上传
  const templateRes = await page.request.get(
    `/api/projects/${projectId}/questionnaire/template`,
  );
  expect(templateRes.ok()).toBeTruthy();
  expect(templateRes.headers()["content-type"]).toContain(
    "spreadsheetml.sheet",
  );
  const filePath = join(
    mkdtempSync(join(tmpdir(), "t360-s3-")),
    "questionnaire-template.xlsx",
  );
  writeFileSync(filePath, Buffer.from(await templateRes.body()));

  // 导入前提示未导入
  await expect(page.getByText("尚未导入问卷")).toBeVisible();

  // UI 上传导入（模板自带可通过全部校验的示例数据）
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.getByRole("button", { name: "导入 Excel" }).click();
  await expect(page.getByText("导入成功（4 个维度、5 道题）")).toBeVisible();
  await expect(page.getByText("4 个维度 · 5 道题")).toBeVisible();

  // 导入问卷后可发布
  await page.getByRole("button", { name: "发布项目" }).click();
  await expect(page.getByText("已发布", { exact: true })).toBeVisible();

  // 预览页：默认自评视角，Q5（覆盖规则：自评是/平级否）可见
  await page.getByRole("link", { name: "查看问卷预览" }).click();
  await page.waitForURL(new RegExp(`/projects/${projectId}/questionnaire$`));
  await expect(page.getByText("团队管理", { exact: true })).toBeVisible();
  await expect(page.getByText("专业能力", { exact: true })).toBeVisible();
  await expect(
    page.getByText("请举例说明该同事最突出的专业表现"),
  ).toBeVisible();

  // 切换到平级视角：Q5 不适用（平级=否），Q4 正常显示
  await page.getByRole("tab", { name: "平级视角" }).click();
  await expect(
    page.getByText("请举例说明该同事最突出的专业表现"),
  ).not.toBeVisible();
  await expect(page.getByText("能够融会贯通跨领域知识解决问题")).toBeVisible();

  // 下级视角仍可见 Q5（下级=是）
  await page.getByRole("tab", { name: "下级视角" }).click();
  await expect(
    page.getByText("请举例说明该同事最突出的专业表现"),
  ).toBeVisible();
});
