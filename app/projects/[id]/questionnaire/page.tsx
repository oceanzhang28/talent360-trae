import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProjectNav } from "@/components/project-nav";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProject } from "@/modules/projects/service";
import { getProjectQuestionnaire } from "@/modules/questionnaires/service";
import { QuestionnaireEditor } from "./questionnaire-editor";
import { RelationView } from "./relation-view";

export const metadata = {
  title: "问卷 · Talent 360",
};

/**
 * 问卷页（PRD 第 11 / 12 节）：
 * - 默认「按关系预览」：查看各类型评价人实际适用的题目
 * - `?view=edit` 且处于可编辑窗口（DRAFT/PUBLISHED 且未锁定）时进入在线搭建编辑器
 */
export default async function QuestionnairePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
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

  // 与 service 层 requireEditableQuestionnaire 保持一致：非草稿/已发布或已锁定即只读
  const editable =
    (project.status === "DRAFT" || project.status === "PUBLISHED") &&
    !questionnaire?.lockedAt;
  const editing = editable && view === "edit";

  return (
    <AppShell user={user}>
      <ProjectNav projectId={id} />
      <PageHeader
        breadcrumbs={[
          { label: "项目列表", href: "/projects" },
          { label: project.name, href: `/projects/${id}` },
        ]}
        title={editing ? "在线编辑问卷" : "问卷预览"}
        description={
          editing
            ? "维度与题目改动自动保存；权重与适用关系规则与 Excel 导入完全一致"
            : "按关系视角查看各类型评价人实际适用的题目"
        }
        actions={
          editable ? (
            <Link
              href={
                editing
                  ? `/projects/${id}/questionnaire`
                  : `/projects/${id}/questionnaire?view=edit`
              }
              className="hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium"
            >
              {editing ? "按关系预览" : "在线编辑"}
            </Link>
          ) : (
            <span className="text-muted-foreground text-xs">
              {questionnaire?.lockedAt
                ? "问卷已锁定（已有正式提交），仅可查看"
                : "测评开始后只能查看，如需修改请先截止并解冻"}
            </span>
          )
        }
      />

      {editing ? (
        <QuestionnaireEditor projectId={id} initial={questionnaire} />
      ) : questionnaire ? (
        <RelationView questionnaire={questionnaire} />
      ) : (
        <p className="text-muted-foreground rounded-md border p-4 text-sm">
          该项目尚未导入问卷。可回到项目设置用 Excel
          导入模板，或在「在线编辑」中从零搭建。
        </p>
      )}
    </AppShell>
  );
}
