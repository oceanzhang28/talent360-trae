import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">进度看板</h1>
          <p className="text-muted-foreground text-sm">
            {progress.project.name}
          </p>
        </div>
        <Link
          href={`/projects/${id}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回项目设置
        </Link>
      </div>
      <ProgressBoard
        projectId={id}
        progress={progress}
        isSystemAdmin={user.systemRole === "SYSTEM_ADMIN"}
      />
    </main>
  );
}
