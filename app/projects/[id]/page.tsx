import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProject } from "@/modules/projects/service";
import { STATUS_BADGE, STATUS_LABEL } from "@/modules/projects/status";
import { AdminsManager } from "./admins-manager";
import { LifecycleActions } from "./lifecycle-actions";
import { ProjectEditForm } from "./project-edit-form";
import { ScalesEditor } from "./scales-editor";

export const metadata = {
  title: "项目设置 · Talent 360",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 服务端权限校验（AGENTS 铁律 9）：非项目管理员/系统管理员无法查看
  let data: Awaited<ReturnType<typeof getProject>>;
  try {
    data = await getProject(id, user);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) notFound();
      redirect("/");
    }
    throw err;
  }

  const { project, admins, scales } = data;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{project.name}</h1>
          <Badge variant={STATUS_BADGE[project.status]}>
            {STATUS_LABEL[project.status]}
          </Badge>
        </div>
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回列表
        </Link>
      </div>

      <LifecycleActions
        project={project}
        isSystemAdmin={user.systemRole === "SYSTEM_ADMIN"}
      />
      <ProjectEditForm project={project} />
      <ScalesEditor
        projectId={project.id}
        scales={scales}
        editable={project.status === "DRAFT" || project.status === "PUBLISHED"}
      />
      <AdminsManager projectId={project.id} admins={admins} />
    </main>
  );
}
