/**
 * 飞书认证抽象（技术文档第 36 节）。
 * 业务模块禁止直接调用飞书 HTTP 接口，统一通过本服务。
 *
 * 端点说明：具体 scope 与 API 版本以飞书开放平台最新文档为准
 * https://open.feishu.cn/document/common-capabilities/sso/api/get-user-info
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
  baseUrl: string;
  redirectUri: string;
}

export class FeishuAuthService {
  constructor(private readonly config: FeishuAuthConfig) {}

  /** 生成 OAuth 授权地址（PC 扫码 / 移动端授权同一入口） */
  getAuthorizationUrl(state: string): string {
    const url = new URL(`${this.config.baseUrl}/open-apis/authen/v1/authorize`);
    url.searchParams.set("app_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  /** 授权码换取 user_access_token */
  async exchangeCode(code: string): Promise<string> {
    const res = await fetch(
      `${this.config.baseUrl}/open-apis/authen/v2/oauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          code,
          redirect_uri: this.config.redirectUri,
        }),
      },
    );
    const body = (await res.json()) as {
      code?: number;
      msg?: string;
      access_token?: string;
    };
    if (!res.ok || body.code !== 0 || !body.access_token) {
      // 注意：不打印 app_secret / token（AGENTS 铁律 10）
      throw new Error(`飞书授权码换取失败（code=${body.code ?? res.status}）`);
    }
    return body.access_token;
  }

  /** 获取当前登录用户身份（含 employee_no） */
  async getCurrentUser(accessToken: string): Promise<FeishuIdentity> {
    const res = await fetch(
      `${this.config.baseUrl}/open-apis/authen/v1/user_info`,
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
  const baseUrl = process.env.FEISHU_BASE_URL || "https://open.feishu.cn";
  if (!appId || !appSecret || !redirectUri) {
    throw new Error(
      "飞书配置不完整：需要 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_REDIRECT_URI",
    );
  }
  return new FeishuAuthService({ appId, appSecret, baseUrl, redirectUri });
}
