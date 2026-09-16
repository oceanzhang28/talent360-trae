import { describe, expect, it } from "vitest";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  signSession,
  verifySessionToken,
} from "@/modules/auth/session";

describe("session JWT", () => {
  it("签发后可验证并还原 payload", async () => {
    const token = await signSession({ userId: "user-1", loginAt: 1234567890 });
    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ userId: "user-1", loginAt: 1234567890 });
  });

  it("篡改 token 后验证失败", async () => {
    const token = await signSession({ userId: "user-1", loginAt: 1234567890 });
    const payload = await verifySessionToken(`${token}x`);
    expect(payload).toBeNull();
  });

  it("非 JWT 字符串验证失败", async () => {
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });

  it("使用其他密钥签发的 token 验证失败", async () => {
    // 换密钥签发（模拟另一个环境）
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "another-secret-key-9876543210abcdef";
    const foreignToken = await signSession({ userId: "user-2", loginAt: 1 });
    process.env.SESSION_SECRET = original;
    expect(await verifySessionToken(foreignToken)).toBeNull();
  });

  it("导出的 Cookie 常量符合约定", () => {
    expect(SESSION_COOKIE).toBe("talent360_session");
    expect(OAUTH_STATE_COOKIE).toBe("talent360_oauth_state");
  });
});
