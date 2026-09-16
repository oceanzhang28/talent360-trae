import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProjectNav } from "@/components/project-nav";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProjectProgress } from "@/modules/results/service";
import { ProgressBoard } from "./progress-board";

export const metadata = {
  title: "进度看板 · Talent 360",
};

/** HR 进度看板页（PRD 第 30、36~37 节）：总体/分关系完成率 + 催办视图 + 冻结入口 */
export default async function ProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // JSX 不放 try/catch 内（渲染错误应交给错误边界）
  let progress: Awaited<ReturnType<typeof getProjectProgress>>;
  try {
    progress = await getProjectProgress(id, user);
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
          { label: progress.project.name, href: `/projects/${id}` },
        ]}
        title="进度看板"
        description="总体与分关系完成率、催办清单与结果冻结入口"
      />
      <ProgressBoard
        projectId={id}
        progress={progress}
        isSystemAdmin={user.systemRole === "SYSTEM_ADMIN"}
      />
    </AppShell>
  );
}
