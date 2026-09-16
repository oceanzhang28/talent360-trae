import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { listProjectResults } from "@/modules/results/service";
import { ExportButton } from "./export-button";
import { ResultsTable } from "./results-table";

export const metadata = {
  title: "结果后台 · Talent 360",
};

/** HR 结果后台（PRD 第 38 节）：被评人列表，只读冻结快照 */
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
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">结果后台</h1>
          <p className="text-muted-foreground text-sm">
            {results.frozen
              ? `${results.overall.submitted}/${results.overall.expected} 份评价已计入（${(results.overall.rate ?? 0) * 100 > 0 ? ((results.overall.rate ?? 0) * 100).toFixed(2) : "0.00"}%）`
              : "正式结果尚未生成"}
          </p>
        </div>
        <Link
          href={`/projects/${id}/progress`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回进度看板
        </Link>
      </div>

      {results.frozen ? (
        <div className="flex justify-end">
          <ExportButton projectId={id} />
        </div>
      ) : null}

      {!results.frozen ? (
        <div className="rounded-md border p-6 text-center">
          <p className="font-medium">项目未冻结，暂无正式结果</p>
          <p className="text-muted-foreground mt-1 text-sm">
            请先在进度看板确认数据并冻结（PRD 第 37 节）
          </p>
          <Link
            href={`/projects/${id}/progress`}
            className="text-primary mt-3 inline-block text-sm underline-offset-4 hover:underline"
          >
            前往进度看板 →
          </Link>
        </div>
      ) : (
        <ResultsTable projectId={id} reviewees={results.reviewees} />
      )}
    </main>
  );
}
