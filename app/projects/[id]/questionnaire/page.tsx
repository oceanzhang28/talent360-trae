import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProjectNav } from "@/components/project-nav";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProject } from "@/modules/projects/service";
import { getProjectQuestionnaire } from "@/modules/questionnaires/service";
import { RelationView } from "./relation-view";

export const metadata = {
  title: "问卷预览 · Talent 360",
};

/** 问卷只读预览页：按关系视角查看适用题目（PRD 第 11 节） */
export default async function QuestionnairePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let project: Awaited<ReturnType<typeof getProject>>["project"];
  let questionnaire: Awaited<ReturnType<typeof getProjectQuestionnaire>>;
  try {
    project = (await getProject(id, user)).project;
    questionnaire = await getProjectQuestionnaire(id, user);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) notFound();
      redirect("/");
    }
    throw err;
  }

  return (
    <AppShell user={user}>
      <ProjectNav projectId={id} />
      <PageHeader
        breadcrumbs={[
          { label: "项目列表", href: "/projects" },
          { label: project.name, href: `/projects/${id}` },
        ]}
        title="问卷预览"
        description="按关系视角查看各类型评价人实际适用的题目"
      />

      {questionnaire ? (
        <RelationView questionnaire={questionnaire} />
      ) : (
        <p className="text-muted-foreground rounded-md border p-4 text-sm">
          该项目尚未导入问卷。
        </p>
      )}
    </AppShell>
  );
}
