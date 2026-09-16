import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuAuthService } from "@/modules/feishu/auth";

/**
 * 飞书 OAuth 端点口径单测（P0 真机联调前置）：
 * 授权页码用 accounts 域 + client_id/response_type，令牌走 v3，user_info 仍在 open 域。
 */

const config = {
  appId: "cli_test_app_id",
  appSecret: "test_app_secret",
  redirectUri: "http://localhost:3001/api/auth/feishu/callback",
  accountsBaseUrl: "https://accounts.feishu.cn",
  apiBaseUrl: "https://open.feishu.cn",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FeishuAuthService.getAuthorizationUrl", () => {
  it("使用 accounts 域的授权端点与 client_id/response_type 参数", () => {
    const url = new URL(
      new FeishuAuthService(config).getAuthorizationUrl("st1"),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("cli_test_app_id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe("st1");
    // 旧版参数不应再出现
    expect(url.searchParams.get("app_id")).toBeNull();
  });

  it("配置了 scopes 才带 scope 参数", () => {
    const withScope = new URL(
      new FeishuAuthService({
        ...config,
        scopes: "contact:user.base:readonly",
      }).getAuthorizationUrl("st1"),
    );
    expect(withScope.searchParams.get("scope")).toBe(
      "contact:user.base:readonly",
    );
    const without = new URL(
      new FeishuAuthService(config).getAuthorizationUrl("st1"),
    );
    expect(without.searchParams.get("scope")).toBeNull();
  });
});

describe("FeishuAuthService.exchangeCode", () => {
  it("POST 到 v3 令牌端点并返回 access_token", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ code: 0, access_token: "u-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await new FeishuAuthService(config).exchangeCode("auth-code");
    expect(token).toBe("u-token");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://accounts.feishu.cn/oauth/v3/token");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      client_id: "cli_test_app_id",
      client_secret: "test_app_secret",
      code: "auth-code",
      redirect_uri: config.redirectUri,
    });
  });

  it("失败时抛出原因且不泄露 app_secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "invalid_grant", error_description: "code 已过期" },
          { status: 400 },
        ),
      ),
    );
    await expect(
      new FeishuAuthService(config).exchangeCode("bad-code"),
    ).rejects.toThrow("code 已过期");
    await expect(
      new FeishuAuthService(config).exchangeCode("bad-code"),
    ).rejects.not.toThrow(/test_app_secret/);
  });
});

describe("FeishuAuthService.getCurrentUser", () => {
  it("请求 open 域 user_info 并映射 employee_no", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        code: 0,
        data: {
          open_id: "ou_x",
          union_id: "on_y",
          name: "张三",
          employee_no: "10001",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const identity = await new FeishuAuthService(config).getCurrentUser(
      "u-token",
    );
    expect(identity).toEqual({
      openId: "ou_x",
      unionId: "on_y",
      name: "张三",
      employeeNo: "10001",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://open.feishu.cn/open-apis/authen/v1/user_info");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer u-token",
    );
  });

  it("未开通「获取用户受雇信息」权限时 employee_no 缺失 → null（身份匹配会失败）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 0,
          data: { open_id: "ou_x", name: "张三" },
        }),
      ),
    );
    const identity = await new FeishuAuthService(config).getCurrentUser(
      "u-token",
    );
    expect(identity.employeeNo).toBeNull();
  });
});
