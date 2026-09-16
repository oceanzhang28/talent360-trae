import { withApi } from "@/lib/permissions";
import { loginWithMock, serializeUser } from "@/modules/auth/service";

/** mock 登录（仅 AUTH_MODE=mock 时可用，服务端校验） */
export const POST = withApi(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as {
    employeeNo?: unknown;
    name?: unknown;
  } | null;
  if (
    !body ||
    typeof body.employeeNo !== "string" ||
    typeof body.name !== "string"
  ) {
    return Response.json(
      { error: "参数错误：需要 employeeNo 与 name" },
      { status: 400 },
    );
  }
  const user = await loginWithMock({
    employeeNo: body.employeeNo,
    name: body.name,
  });
  return Response.json(serializeUser(user));
});
