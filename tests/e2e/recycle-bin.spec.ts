import { expect, test, type Page } from "@playwright/test";

/**
 * 回收站与恢复 E2E（PRD 第 44 节）：删除 → 回收站可见 → 恢复 → 项目列表恢复可见。
 * 彻底清理需要 30 天保留期到期，无法在 E2E 中等待，由集成测试覆盖。
 * 在 chromium + mobile 两个工程上各跑一遍。
 */

const ADMIN = { employeeNo: "00000", name: "系统管理员" };
const NORMAL = { employeeNo: "e2e-s15-user", name: "E2E普通用户" };

async function mockLogin(page: Page, employeeNo: string, name: string) {
  await page.goto("/login");
  await page.getByLabel("工号").fill(employeeNo);
  await page.getByLabel("姓名").fill(name);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("/");
}

/** 通过 API 建项目并删除（回收站里需要一个项目） */
async function createDeletedProject(page: Page): Promise<{
  id: string;
  name: string;
}> {
  const name = `E2E-S15-待删除项目-${Date.now()}`;
  const created = await page.request.post("/api/projects", {
    data: {
      name,
      startAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      endAt: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    },
  });
  expect(created.ok()).toBeTruthy();
  const id = ((await created.json()) as { project: { id: string } }).project.id;

  const deleted = await page.request.delete(`/api/projects/${id}`);
  expect(deleted.status()).toBe(204);
  return { id, name };
}

test("回收站：删除后进回收站（保留期未满不可清理）→ 恢复后项目列表可见", async ({
  page,
}) => {
  await mockLogin(page, ADMIN.employeeNo, ADMIN.name);
  const project = await createDeletedProject(page);

  // --- 删除后不在项目列表 ---
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: project.name })).toHaveCount(0);

  // --- 回收站入口可见（仅系统管理员），进入回收站 ---
  await expect(
    page.getByRole("link", { name: "回收站", exact: true }),
  ).toBeVisible();
  await page.goto("/projects/recycle-bin");
  const row = page.getByTestId(`deleted-${project.name}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("草稿");
  await expect(row).toContainText(/剩余 3[0-9] 天|剩余 29 天/);
  await expect(row.getByRole("button", { name: "彻底清理" })).toBeDisabled();

  // --- 恢复（confirm 确认）---
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("确定恢复项目");
    void dialog.accept();
  });
  await row.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByTestId("recycle-notice")).toContainText(
    `已恢复项目「${project.name}」`,
  );
  await expect(page.getByTestId(`deleted-${project.name}`)).toHaveCount(0);

  // --- 项目列表重新可见，且回收站为空态 ---
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: project.name })).toBeVisible();
});

test("回收站权限：普通用户被重定向，接口 403", async ({ page }) => {
  await mockLogin(page, NORMAL.employeeNo, NORMAL.name);

  // 页面：服务端重定向回项目列表
  await page.goto("/projects/recycle-bin");
  await page.waitForURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "回收站" })).toHaveCount(0);

  // 接口：明确 403（界面不可见不算鉴权）
  const list = await page.request.get("/api/projects/recycle-bin");
  expect(list.status()).toBe(403);
  const purge = await page.request.post(
    "/api/projects/recycle-bin/purge-expired",
  );
  expect(purge.status()).toBe(403);
  const restore = await page.request.post("/api/projects/not-exist/restore");
  expect(restore.status()).toBe(403);
});
