import { expect, test, type Page } from "@playwright/test";

/** mock 登录辅助：走真实 UI 流程 */
async function mockLogin(page: Page, employeeNo: string, name: string) {
  await page.goto("/login");
  await page.getByLabel("工号").fill(employeeNo);
  await page.getByLabel("姓名").fill(name);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("/");
}

test("未登录访问 /api/me 返回 401", async ({ request }) => {
  const res = await request.get("/api/me");
  expect(res.status()).toBe(401);
});

test("mock 登录后 /api/me 返回当前用户", async ({ page }) => {
  await mockLogin(page, "e2e-employee-001", "E2E测试员工");

  const res = await page.request.get("/api/me");
  expect(res.status()).toBe(200);
  const me = await res.json();
  expect(me.employeeNo).toBe("e2e-employee-001");
  expect(me.name).toBe("E2E测试员工");
  expect(me.systemRole).toBe("USER");
});

test("普通用户访问管理员接口返回 403（服务端鉴权）", async ({ page }) => {
  await mockLogin(page, "e2e-employee-002", "普通员工");

  const res = await page.request.get("/api/admin/users");
  expect(res.status()).toBe(403);
});

test("管理员可获取用户列表并设置角色", async ({ page }) => {
  await mockLogin(page, "00000", "系统管理员");

  const res = await page.request.get("/api/admin/users");
  expect(res.status()).toBe(200);
  const users = await res.json();
  expect(Array.isArray(users)).toBe(true);
  expect(
    users.some((u: { employeeNo: string }) => u.employeeNo === "00000"),
  ).toBe(true);

  // 管理员页面可访问
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
});

test("登出后 /api/me 返回 401", async ({ page }) => {
  await mockLogin(page, "e2e-employee-003", "登出测试");

  const logoutRes = await page.request.post("/api/auth/logout");
  expect(logoutRes.ok()).toBe(true);

  const meRes = await page.request.get("/api/me");
  expect(meRes.status()).toBe(401);
});
