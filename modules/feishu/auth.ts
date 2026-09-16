/**
 * 飞书认证抽象（技术文档第 36 节）。
 * 业务模块禁止直接调用飞书 HTTP 接口，统一通过本服务。
 *
 * 端点口径（以飞书开放平台官方文档为准，2026-09 核对）：
 * - 获取授权码：`https://accounts.feishu.cn/open-apis/authen/v1/authorize`
 *   （accounts 域 + `client_id` + `response_type=code`；旧版 open 域 `authen/v1/index` + `app_id` 已不推荐）
 * - 换取 user_access_token：`https://accounts.feishu.cn/oauth/v3/token`
 *   （v2 `open.feishu.cn/open-apis/authen/v2/oauth/token` 已成为历史版本）
 * - 获取用户信息：`https://open.feishu.cn/open-apis/authen/v1/user_info`（仍在 open 域）
 *
 * 注意：`employee_no` 属敏感字段，需在开发者后台申请「获取用户受雇信息」字段权限并发布版本，
 * 否则接口返回中不含该字段（PRD 第 22 节身份匹配依赖它）。
 */

export interface FeishuIdentity {
  openId: string;
  unionId: string | null;
  name: string;
  employeeNo: string | null;
}

export interface FeishuAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  /** OAuth 授权页与令牌端点基址（accounts 域） */
  accountsBaseUrl: string;
  /** OpenAPI 基址（user_info 等接口） */
  apiBaseUrl: string;
  /** 需用户授权的 scope（空格分隔，取自开发者后台「权限管理」）；留空则不传 scope */
  scopes?: string;
}

export class FeishuAuthService {
  constructor(private readonly config: FeishuAuthConfig) {}

  /** 生成 OAuth 授权地址（PC 扫码 / 移动端授权同一入口） */
  getAuthorizationUrl(state: string): string {
    const url = new URL(
      "/open-apis/authen/v1/authorize",
      this.config.accountsBaseUrl,
    );
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", state);
    if (this.config.scopes) {
      url.searchParams.set("scope", this.config.scopes);
    }
    return url.toString();
  }

  /** 授权码换取 user_access_token */
  async exchangeCode(code: string): Promise<string> {
    const res = await fetch(`${this.config.accountsBaseUrl}/oauth/v3/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });
    const body = (await res.json()) as {
      code?: number;
      msg?: string;
      error?: string;
      error_description?: string;
      access_token?: string;
    };
    if (!res.ok || !body.access_token) {
      // 注意：不打印 app_secret / token（AGENTS 铁律 10）
      const reason =
        body.error_description ??
        body.error ??
        body.msg ??
        String(body.code ?? res.status);
      throw new Error(`飞书授权码换取失败（${reason}）`);
    }
    return body.access_token;
  }

  /** 获取当前登录用户身份（含 employee_no，需对应字段权限） */
  async getCurrentUser(accessToken: string): Promise<FeishuIdentity> {
    const res = await fetch(
      `${this.config.apiBaseUrl}/open-apis/authen/v1/user_info`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const body = (await res.json()) as {
      code?: number;
      msg?: string;
      data?: {
        open_id?: string;
        union_id?: string;
        name?: string;
        employee_no?: string;
      };
    };
    if (!res.ok || body.code !== 0 || !body.data?.open_id) {
      throw new Error(
        `获取飞书用户信息失败（code=${body.code ?? res.status}）`,
      );
    }
    return {
      openId: body.data.open_id,
      unionId: body.data.union_id ?? null,
      name: body.data.name ?? "",
      employeeNo: body.data.employee_no ?? null,
    };
  }
}

/** 从环境变量构建服务实例（AUTH_MODE=feishu 时使用） */
export function getFeishuAuthService(): FeishuAuthService {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const redirectUri = process.env.FEISHU_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    throw new Error(
      "飞书配置不完整：需要 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_REDIRECT_URI",
    );
  }
  return new FeishuAuthService({
    appId,
    appSecret,
    redirectUri,
    accountsBaseUrl:
      process.env.FEISHU_ACCOUNTS_BASE_URL || "https://accounts.feishu.cn",
    apiBaseUrl: process.env.FEISHU_API_BASE_URL || "https://open.feishu.cn",
    scopes: process.env.FEISHU_SCOPES?.trim() || undefined,
  });
}
