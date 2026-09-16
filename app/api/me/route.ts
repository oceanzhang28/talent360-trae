import { requireLogin, withApi } from "@/lib/permissions";
import { serializeUser } from "@/modules/auth/service";

export const GET = withApi(async () => {
  const user = await requireLogin();
  return Response.json(serializeUser(user));
});
