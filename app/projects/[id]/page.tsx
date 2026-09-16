import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProjectNav } from "@/components/project-nav";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProject } from "@/modules/projects/service";
import { getProjectQuestionnaire } from "@/modules/questionnaires/service";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  formatDateTime,
} from "@/modules/projects/status";
import { AdminsManager } from "./admins-manager";
import { LifecycleActions } from "./lifecycle-actions";
import { ProjectEditForm } from "./project-edit-form";
import { QuestionnaireCard } from "./questionnaire-card";
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
  const questionnaire = await getProjectQuestionnaire(id, user);

  return (
    <AppShell user={user}>
      <ProjectNav projectId={project.id} />
      <PageHeader
        breadcrumbs={[{ label: "项目列表", href: "/projects" }]}
        title={project.name}
        badge={
          <Badge variant={STATUS_BADGE[project.status]}>
            {STATUS_LABEL[project.status]}
          </Badge>
        }
        description={`${formatDateTime(project.startAt)} 至 ${formatDateTime(project.endAt)} · 自评${project.selfReviewEnabled ? "已启用" : "未启用"}`}
      />

      <LifecycleActions
        project={project}
        isSystemAdmin={user.systemRole === "SYSTEM_ADMIN"}
      />
      <ProjectEditForm project={project} />
      <QuestionnaireCard
        projectId={project.id}
        questionnaire={questionnaire}
        editable={
          (project.status === "DRAFT" || project.status === "PUBLISHED") &&
          !questionnaire?.lockedAt
        }
      />
      <ScalesEditor
        projectId={project.id}
        scales={scales}
        editable={project.status === "DRAFT" || project.status === "PUBLISHED"}
      />
      <AdminsManager projectId={project.id} admins={admins} />
    </AppShell>
  );
}
