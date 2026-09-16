import { expect, test } from "@playwright/test";

// Sprint 0 冒烟：开发服务器可启动且首页可渲染
// 首次运行前需执行：npx playwright install chromium
test("首页可访问且正常渲染", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Talent|360|Next/i);
});
