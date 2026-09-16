import { withApi } from "@/lib/permissions";
import { logout } from "@/modules/auth/service";

export const POST = withApi(async () => {
  await logout();
  return Response.json({ ok: true });
});
