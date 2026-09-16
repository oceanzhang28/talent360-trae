import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProjectNav } from "@/components/project-nav";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { listProjectResults } from "@/modules/results/service";
import { ExportButton } from "./export-button";
import { ResultsTable } from "./results-table";

export const metadata = {
  title: "结果后台 · Talent 360",
};

/** HR 结果后台（PRD 第 38 节）：被评人列表；未冻结时为实时计分，冻结后为只读快照 */
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // JSX 不放 try/catch 内（渲染错误应交给错误边界）
  let results: Awaited<ReturnType<typeof listProjectResults>>;
  try {
    results = await listProjectResults(id, user);
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
          { label: "项目设置", href: `/projects/${id}` },
        ]}
        title="结果后台"
        description={`${results.overall.submitted}/${results.overall.expected} 份评价${results.frozen ? "已计入" : "已提交"}（${((results.overall.rate ?? 0) * 100).toFixed(2)}%）${results.frozen ? "" : " · 实时"}`}
        actions={results.frozen ? <ExportButton projectId={id} /> : undefined}
      />

      {!results.frozen && results.reviewees.length > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          当前为<b>实时数据</b>（基于已提交评价动态计算，未锁定显示）；
          冻结后将固化为正式快照，导出版本以冻结后为准。
        </div>
      )}

      {results.reviewees.length === 0 ? (
        <div className="rounded-md border p-6 text-center">
          <p className="font-medium">暂无已提交结果</p>
          <p className="text-muted-foreground mt-1 text-sm">
            评价人提交后即可在此查看实时结果，冻结后固化为正式快照
          </p>
          <Link
            href={`/projects/${id}/progress`}
            className="text-primary mt-3 inline-block text-sm underline-offset-4 hover:underline"
          >
            前往进度看板 →
          </Link>
        </div>
      ) : (
        <ResultsTable
          projectId={id}
          reviewees={results.reviewees}
          frozen={results.frozen}
        />
      )}
    </AppShell>
  );
}
