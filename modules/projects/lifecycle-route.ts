import type { User } from "@/app/generated/prisma/client";
import { requireLogin, withApi } from "@/lib/permissions";
import type { ProjectDTO } from "./service";

/** 生命周期操作路由工厂：POST /api/projects/:id/<action> */
export function lifecycleRoute(
  action: (projectId: string, user: User) => Promise<ProjectDTO>,
) {
  return withApi<{ params: Promise<{ id: string }> }>(
    async (_req, { params }) => {
      const user = await requireLogin();
      const { id } = await params;
      return Response.json({ project: await action(id, user) });
    },
  );
}
