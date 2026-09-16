"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ProgressDTO,
  RateDTO,
  RevieweeProgressDTO,
  ReviewerProgressDTO,
} from "@/modules/results/service";

const pct = (rate: number | null) =>
  rate === null ? "—" : `${(rate * 100).toFixed(2)}%`;

const xy = (rate: RateDTO) =>
  rate.expected === 0 ? "—" : `${rate.submitted}/${rate.expected}`;

/** HR 进度看板：汇总卡片 + 完整性警告 + 冻结/解冻 + 按被评人/按评价人表格 */
export function ProgressBoard({
  projectId,
  progress,
  isSystemAdmin,
}: {
  projectId: string;
  progress: ProgressDTO;
  isSystemAdmin: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"reviewee" | "reviewer">("reviewee");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { project, overall, relations, byReviewee, byReviewer } = progress;
  const incomplete =
    overall.expected === 0 || overall.submitted < overall.expected;
  const selfPending = byReviewee.filter((r) => r.self && !r.self.done);

  async function run(action: "freeze" | "unfreeze", confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "操作失败");
        return;
      }
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(null);
    }
  }

  function handleFreeze() {
    const lines = [
      `确定冻结项目「${project.name}」吗？冻结后形成正式结果，报告只读结果快照。`,
      "",
      `应完成 ${overall.expected} 份 / 已完成 ${overall.submitted} 份（${pct(overall.rate)}）`,
      `上级 ${xy(relations.manager)} · 平级 ${xy(relations.peer)} · 下级 ${xy(relations.subordinate)}`,
      `自评 ${xy(relations.self)}`,
    ];
    if (incomplete) {
      lines.push(
        "",
        "注意：当前结果完整性不足，未完成的关系/自评将按归一化规则计分。",
      );
    }
    void run("freeze", lines.join("\n"));
  }

  const revieweeColumns: ColumnDef<RevieweeProgressDTO>[] = [
    {
      header: "被评人",
      cell: ({ row }) => (
        <div>
          <p>{row.original.name}</p>
          <p className="text-muted-foreground text-xs">
            {row.original.employeeNo}
            {row.original.department ? ` · ${row.original.department}` : ""}
          </p>
        </div>
      ),
    },
    {
      header: "自评",
      cell: ({ row }) =>
        row.original.self === null ? (
          <span className="text-muted-foreground">—</span>
        ) : row.original.self.done ? (
          <Badge>已完成</Badge>
        ) : (
          <Badge variant="destructive">未完成</Badge>
        ),
    },
    { header: "上级", cell: ({ row }) => xy(row.original.manager) },
    { header: "平级", cell: ({ row }) => xy(row.original.peer) },
    { header: "下级", cell: ({ row }) => xy(row.original.subordinate) },
    {
      header: "合计",
      cell: ({ row }) => (
        <span>
          {xy(row.original.total)}
          {row.original.total.rate !== null && (
            <span className="text-muted-foreground ml-1 text-xs">
              ({pct(row.original.total.rate)})
            </span>
          )}
        </span>
      ),
    },
  ];

  const reviewerColumns: ColumnDef<ReviewerProgressDTO>[] = [
    {
      header: "评价人",
      cell: ({ row }) => (
        <div>
          <p>{row.original.name}</p>
          <p className="text-muted-foreground text-xs">
            {row.original.employeeNo}
            {row.original.department ? ` · ${row.original.department}` : ""}
          </p>
        </div>
      ),
    },
    { header: "自评", cell: ({ row }) => xy(row.original.self) },
    { header: "上级", cell: ({ row }) => xy(row.original.manager) },
    { header: "平级", cell: ({ row }) => xy(row.original.peer) },
    { header: "下级", cell: ({ row }) => xy(row.original.subordinate) },
    { header: "应评", cell: ({ row }) => row.original.total.expected },
    { header: "已完成", cell: ({ row }) => row.original.total.submitted },
    {
      header: "剩余",
      cell: ({ row }) =>
        row.original.remaining > 0 ? (
          <span className="text-destructive font-medium">
            {row.original.remaining}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
  ];

  // TanStack Table v8 与 React Compiler 不兼容（官方已知限制），跳过编译
  // eslint-disable-next-line react-hooks/incompatible-library
  const revieweeTable = useReactTable({
    data: byReviewee,
    columns: revieweeColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  const reviewerTable = useReactTable({
    data: byReviewer,
    columns: reviewerColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const cards: Array<{ label: string; rate: RateDTO }> = [
    { label: "上级", rate: relations.manager },
    { label: "平级", rate: relations.peer },
    { label: "下级", rate: relations.subordinate },
    { label: "自评", rate: relations.self },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>项目总体</CardDescription>
            <CardTitle className="text-2xl">{pct(overall.rate)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            应完成 {overall.expected} 份 · 已完成 {overall.submitted} 份
          </CardContent>
        </Card>
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-2xl">{pct(card.rate.rate)}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              已完成 {card.rate.submitted} / 应评 {card.rate.expected}
            </CardContent>
          </Card>
        ))}
      </div>

      {project.status === "CLOSED" && (
        <Card>
          <CardHeader>
            <CardTitle>冻结结果</CardTitle>
            <CardDescription>
              项目已截止。确认数据无误后冻结，形成正式结果快照（PRD 第 37 节）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleFreeze} disabled={loading !== null}>
              {loading === "freeze" ? "冻结中…" : "冻结结果"}
            </Button>
          </CardContent>
        </Card>
      )}

      {!["FROZEN", "ARCHIVED"].includes(project.status) &&
        overall.submitted > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>已提交结果（实时）</CardTitle>
              <CardDescription>
                当前基于已提交评价动态计算，未锁定；冻结后固化为正式快照
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/projects/${projectId}/results`}>
                  查看实时结果后台
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

      {(project.status === "FROZEN" || project.status === "ARCHIVED") && (
        <Card>
          <CardHeader>
            <CardTitle>正式结果</CardTitle>
            <CardDescription>
              {project.frozenAt
                ? `已于 ${new Date(project.frozenAt).toLocaleString("zh-CN")} 冻结`
                : "项目已冻结"}
              ，报告只读结果快照，不受后续业务数据变化影响
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/projects/${projectId}/results`}>查看结果后台</Link>
            </Button>
            {isSystemAdmin && project.status === "FROZEN" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  run(
                    "unfreeze",
                    "确定解冻吗？解冻后项目回到已截止状态，结果快照将被删除，重新冻结时整体重算。",
                  )
                }
                disabled={loading !== null}
              >
                {loading === "unfreeze" ? "解冻中…" : "解冻（仅系统管理员）"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {incomplete && project.status !== "FROZEN" && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          role="alert"
          data-testid="completeness-warning"
        >
          <p className="font-medium">结果完整性不足</p>
          <p>
            应评价 {overall.expected} 份 · 实际评价 {overall.submitted} 份 ·
            总完成率 {pct(overall.rate)}；上级 {xy(relations.manager)} · 平级{" "}
            {xy(relations.peer)} · 下级 {xy(relations.subordinate)} · 自评{" "}
            {relations.self.done ? "已完成" : xy(relations.self)}
            {selfPending.length > 0 &&
              `；${selfPending.length} 人未完成自评（${selfPending
                .slice(0, 5)
                .map((r) => r.name)
                .join("、")}${selfPending.length > 5 ? " 等" : ""}）`}
          </p>
          <p className="mt-1 text-xs">
            允许未 100% 完成时冻结，未完成部分按评分引擎归一化规则计分
          </p>
        </div>
      )}

      {error && (
        <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="进度视图"
      >
        {(
          [
            ["reviewee", `按被评人（${byReviewee.length}）`],
            ["reviewer", `按评价人（${byReviewer.length}）`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
                : "bg-muted text-foreground hover:bg-muted/80 rounded-md px-3 py-1.5 text-sm"
            }
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {tab === "reviewee"
              ? "被评人分关系完成表"
              : "评价人完成情况（催办）"}
          </CardTitle>
          <CardDescription>
            {tab === "reviewee"
              ? "自评/上级/平级/下级各关系的提交进度（PRD 第 30 节）"
              : "应评 X 人 / 已完成 / 剩余，供 HR 线下催办"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            {tab === "reviewee" ? (
              <Table>
                <TableHeader>
                  {revieweeTable.getHeaderGroups().map((group) => (
                    <TableRow key={group.id}>
                      {group.headers.map((header) => (
                        <TableHead key={header.id}>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {revieweeTable.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  {reviewerTable.getHeaderGroups().map((group) => (
                    <TableRow key={group.id}>
                      {group.headers.map((header) => (
                        <TableHead key={header.id}>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {reviewerTable.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {(tab === "reviewee" ? byReviewee : byReviewer).length === 0 && (
              <p className="text-muted-foreground py-6 text-center text-sm">
                暂无评价关系数据
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
