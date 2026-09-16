import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProject } from "@/modules/projects/service";
import { getProjectQuestionnaire } from "@/modules/questionnaires/service";
import { STATUS_BADGE, STATUS_LABEL } from "@/modules/projects/status";
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
      <QuestionnaireCard
        projectId={project.id}
        questionnaire={questionnaire}
        editable={
          (project.status === "DRAFT" || project.status === "PUBLISHED") &&
          !questionnaire?.lockedAt
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>人员与评价关系</CardTitle>
          <CardDescription>
            Excel 导入（预检查 → 正式导入）、手工增删改、自评自动生成
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${project.id}/people`}>管理人员与关系</Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>进度与结果</CardTitle>
          <CardDescription>
            进度看板（催办 + 冻结入口）；结果后台
            {project.status === "FROZEN" || project.status === "ARCHIVED"
              ? "（只读冻结快照）"
              : "（实时，仅统计已提交评价）"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${project.id}/progress`}>进度看板</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${project.id}/results`}>结果后台</Link>
          </Button>
        </CardContent>
      </Card>
      <ScalesEditor
        projectId={project.id}
        scales={scales}
        editable={project.status === "DRAFT" || project.status === "PUBLISHED"}
      />
      <AdminsManager projectId={project.id} admins={admins} />
    </main>
  );
}
