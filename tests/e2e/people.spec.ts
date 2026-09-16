import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
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

/** 构造关系 Excel 并落盘，返回文件路径 */
async function buildRelationExcel(
  rows: (string | number)[][],
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("评价关系");
  sheet.addRow([
    "被评人工号",
    "被评人姓名",
    "被评人部门",
    "被评人岗位",
    "被评人职级",
    "评价人工号",
    "评价人姓名",
    "评价关系",
  ]);
  for (const row of rows) sheet.addRow(row);
  const filePath = join(
    mkdtempSync(join(tmpdir(), "t360-s4-")),
    "relations.xlsx",
  );
  writeFileSync(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
  return filePath;
}

test("关系导入预检查：错误/冲突明细展示且禁用正式导入", async ({ page }) => {
  await mockLogin(page, "e2e-s4-hr", "E2E人员管理员");
  const projectId = await createProjectViaUi(
    page,
    `E2E-S4-预检查-${Date.now()}`,
  );
  await page.goto(`/projects/${projectId}/people`);

  const filePath = await buildRelationExcel([
    [
      "10001",
      "张三",
      "商品中心",
      "商品经理",
      "经理级",
      "10002",
      "李四",
      "上级",
    ],
    [
      "10001",
      "张三",
      "商品中心",
      "商品经理",
      "经理级",
      "10002",
      "李四",
      "平级",
    ], // 冲突
    ["10003", "王五", "", "商品主管", "主管级", "10004", "赵六", "上级"], // 部门为空
  ]);

  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.getByRole("button", { name: "预检查" }).click();

  await expect(page.getByText("总行数：3")).toBeVisible();
  await expect(page.getByText("有效：1")).toBeVisible();
  await expect(page.getByText("错误：1")).toBeVisible();
  await expect(page.getByText("冲突：1")).toBeVisible();
  await expect(page.getByText(/被评人部门为空/)).toBeVisible();
  await expect(
    page.getByText(/同一评价人对同一被评人存在两种关系/),
  ).toBeVisible();

  // 存在错误/冲突时禁止正式导入
  await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
  // 未写入任何数据
  await expect(page.getByText("关系列表（0）")).toBeVisible();
});

test("完整流程：模板导入 → 自评生成 → 人员统计 → 手工新增/修改/删除", async ({
  page,
}) => {
  await mockLogin(page, "e2e-s4-hr", "E2E人员管理员");
  const projectId = await createProjectViaUi(
    page,
    `E2E-S4-人员项目-${Date.now()}`,
  );

  // 从项目级常驻导航进入人员与关系管理页
  await page.getByRole("link", { name: "人员与关系" }).click();
  await page.waitForURL(new RegExp(`/projects/${projectId}/people$`));

  // 通过 API 下载模板（与浏览器共享登录态），落盘后经 UI 上传
  const templateRes = await page.request.get(
    `/api/projects/${projectId}/relations/template`,
  );
  expect(templateRes.ok()).toBeTruthy();
  expect(templateRes.headers()["content-type"]).toContain(
    "spreadsheetml.sheet",
  );
  const filePath = join(
    mkdtempSync(join(tmpdir(), "t360-s4-")),
    "relation-template.xlsx",
  );
  writeFileSync(filePath, Buffer.from(await templateRes.body()));

  // 两阶段导入：预检查 → 确认
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.getByRole("button", { name: "预检查" }).click();
  await expect(page.getByText("总行数：4")).toBeVisible();
  await expect(page.getByText("有效：4")).toBeVisible();
  await page.getByRole("button", { name: "确认导入（4 条有效关系）" }).click();
  await expect(
    page.getByText("导入完成：新增关系 4、更新 0、移除 0、自动生成自评 2"),
  ).toBeVisible();

  // 关系表：4 条导入关系 + 2 条自评（张三、李四）
  await expect(page.getByText("关系列表（6）")).toBeVisible();
  await expect(page.getByText("张三", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("赵六", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("自评", { exact: true }).first()).toBeVisible();

  // 人员表：项目快照与统计（张三被评 3 次，李四被评 1 次）
  await page.getByRole("tab", { name: /人员列表/ }).click();
  await expect(page.getByText("人员列表（4）")).toBeVisible();
  const zhangsanRow = page.getByRole("row", { name: /10001/ });
  await expect(zhangsanRow).toContainText("张三");
  await expect(zhangsanRow).toContainText("已生成");
  const lisiRow = page.getByRole("row", { name: /10002/ });
  await expect(lisiRow).toContainText("商品总监");

  // 手工新增：钱七（10005）被张三上级评价；钱七成为新被评人后自动生成自评
  await page.getByRole("tab", { name: /关系列表/ }).click();
  await page.getByRole("button", { name: "手工新增关系" }).click();
  await page.getByLabel("被评人工号 *").fill("10005");
  await page.getByLabel("被评人姓名").fill("钱七");
  await page.getByLabel("被评人部门").fill("市场部");
  await page.getByLabel("评价人工号 *").fill("10001");
  await page.getByLabel("评价人姓名 *").fill("张三");
  await page.getByLabel("关系 *").selectOption("上级");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(
    page.getByText("关系已新增（新被评人自动生成自评）"),
  ).toBeVisible();
  await expect(page.getByText("关系列表（8）")).toBeVisible(); // +钱七上级 +钱七自评
  await expect(page.getByText("钱七", { exact: true }).first()).toBeVisible();

  // 修改关系类型：上级 → 平级
  await page.getByLabel("修改关系类型").first().selectOption("平级");
  await expect(page.getByText("关系类型已更新")).toBeVisible();

  // 删除关系（未提交 → 物理删除）
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除", exact: true }).first().click();
  await expect(page.getByText("关系已删除", { exact: true })).toBeVisible();
  await expect(page.getByText("关系列表（7）")).toBeVisible();
});
