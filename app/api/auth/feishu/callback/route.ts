import { NextResponse, type NextRequest } from "next/server";
import { withApi, ApiError } from "@/lib/permissions";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/modules/auth/session";
import { resolveFeishuUser } from "@/modules/auth/service";
import { getFeishuAuthService } from "@/modules/feishu/auth";

function loginErrorRedirect(req: NextRequest, message: string) {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

/** 飞书 OAuth 回调：校验 state → 换 token → 取身份 → 建立会话 */
export const GET = withApi(async (req: NextRequest) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // CSRF 校验：state 必须与登录前写入的一次性 Cookie 一致
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return loginErrorRedirect(req, "登录状态校验失败，请重新登录");
  }

  try {
    const service = getFeishuAuthService();
    const accessToken = await service.exchangeCode(code);
    const identity = await service.getCurrentUser(accessToken);
    const user = await resolveFeishuUser(identity);

    // 会话 Cookie 设置在 redirect 响应上（避免与 cookies() 合并行为歧义）
    const token = await signSession({ userId: user.id, loginAt: Date.now() });
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "飞书登录失败，请重试";
    return loginErrorRedirect(req, message);
  }
});
