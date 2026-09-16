import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "talent360_session";
/** OAuth state 防 CSRF 用一次性 Cookie */
export const OAUTH_STATE_COOKIE = "talent360_oauth_state";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 分钟

export interface SessionPayload {
  userId: string;
  loginAt: number;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET 未配置或长度不足（至少 16 字符）");
  }
  return new TextEncoder().encode(secret);
}

/** 签发 session JWT（纯函数，供单元测试） */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, loginAt: payload.loginAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

/** 校验 session JWT（纯函数，供单元测试）；无效/过期返回 null */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.userId !== "string" ||
      typeof payload.loginAt !== "number"
    ) {
      return null;
    }
    return { userId: payload.userId, loginAt: payload.loginAt };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  };
}

/** 写入登录 session（Route Handler / Server Action 中调用） */
export async function setSessionCookie(userId: string): Promise<void> {
  const token = await signSession({ userId, loginAt: Date.now() });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** 读取当前登录用户 id；未登录返回 null */
export async function readSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  return payload?.userId ?? null;
}

/** 清除登录 session */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
