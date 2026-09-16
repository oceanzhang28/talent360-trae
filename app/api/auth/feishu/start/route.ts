import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getFeishuAuthService } from "@/modules/feishu/auth";
import {
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
} from "@/modules/auth/session";
import { withApi } from "@/lib/permissions";

/** 发起飞书 OAuth：生成 state 写入一次性 Cookie 后重定向到授权页（CSRF 防护） */
export const GET = withApi(async () => {
  const service = getFeishuAuthService();
  const state = randomBytes(16).toString("hex");

  const res = NextResponse.redirect(service.getAuthorizationUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());
  return res;
});
