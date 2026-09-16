import { expect, test, type Page } from "@playwright/test";

/**
 * 模板库管理页 E2E（PRD 第 13 节）：列表 / 查看内容 / 重命名 / 删除 / 权限可见性。
 * 在 chromium + mobile 两个工程上各跑一遍。
 */

const HR = { employeeNo: "e2e-s13-hr", name: "E2E模板HR" };
const OTHER = { employeeNo: "e2e-s13-other", name: "E2E模板他人" };

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function mockLogin(page: Page, employeeNo: string, name: string) {
  await page.goto("/login");
  await page.getByLabel("工号").fill(employeeNo);
  await page.getByLabel("姓名").fill(name);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("/");
}

/** 建项目 → 导入官方模板 → 保存为问卷模板，返回模板名与模板 ID */
async function createTemplate(page: Page): Promise<{
  name: string;
  templateId: string;
}> {
  const created = await page.request.post("/api/projects", {
    data: {
      name: `E2E-S13-模板源-${Date.now()}`,
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

  const name = `E2E-S13 模板-${Date.now()}`;
  const saved = await page.request.post(
    `/api/projects/${projectId}/questionnaire/save-as-template`,
    { data: { templateName: name } },
  );
  expect(saved.ok()).toBeTruthy();
  const templateId = ((await saved.json()) as { template: { id: string } })
    .template.id;
  return { name, templateId };
}

test("模板库：列表 → 查看内容 → 重命名 → 删除", async ({ page }) => {
  await mockLogin(page, HR.employeeNo, HR.name);
  const { name } = await createTemplate(page);

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "问卷模板库" })).toBeVisible();

  const row = page.getByTestId(`template-${name}`);
  await expect(row).toContainText("4 维度");
  await expect(row).toContainText("5 题");

  // --- 查看内容：维度树（含权重、适用关系与题目）---
  await row.getByRole("button", { name: "查看内容" }).click();
  await expect(row).toContainText("团队管理");
  await expect(row).toContainText("专业能力");
  await expect(row).toContainText("权重 60% · 适用 自评/上级/平级/下级");
  await expect(row).toContainText("能够主动识别并培养团队人才");

  // --- 重命名 ---
  await row.getByRole("button", { name: "重命名" }).click();
  const renamed = `${name}-改名`;
  await row.getByLabel("模板名称").fill(renamed);
  await row.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("template-notice")).toContainText(
    `已重命名为「${renamed}」`,
  );
  const renamedRow = page.getByTestId(`template-${renamed}`);
  await expect(renamedRow).toBeVisible();

  // 刷新后仍是新名字（已落库）
  await page.reload();
  await expect(page.getByTestId(`template-${renamed}`)).toBeVisible();

  // --- 删除（confirm 确认）---
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain(renamed);
    void dialog.accept();
  });
  await page
    .getByTestId(`template-${renamed}`)
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByTestId("template-notice")).toContainText(
    `已删除模板「${renamed}」`,
  );
  await expect(page.getByTestId(`template-${renamed}`)).toHaveCount(0);
});

test("模板库权限：非创建者只能查看内容，无重命名/删除入口", async ({
  page,
}) => {
  await mockLogin(page, HR.employeeNo, HR.name);
  const { name, templateId } = await createTemplate(page);

  // 换一个非创建者且非系统管理员的账号
  await mockLogin(page, OTHER.employeeNo, OTHER.name);
  await page.goto("/templates");

  const row = page.getByTestId(`template-${name}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("仅创建者或系统管理员可修改");
  await expect(row.getByRole("button", { name: "删除" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "重命名" })).toHaveCount(0);

  // 仍可查看内容
  await row.getByRole("button", { name: "查看内容" }).click();
  await expect(row).toContainText("团队管理");

  // 服务端兜底：越权重命名 / 删除均被拦截（界面隐藏不算鉴权）
  const renamed = await page.request.patch(
    `/api/questionnaire/templates/${templateId}`,
    { data: { templateName: `${name}-越权` } },
  );
  expect(renamed.status()).toBe(403);
  const removed = await page.request.delete(
    `/api/questionnaire/templates/${templateId}`,
  );
  expect(removed.status()).toBe(403);
});
