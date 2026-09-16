"use client";

import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
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
import type { ResultRevieweeDTO } from "@/modules/results/service";

const score = (value: number | null) =>
  value === null ? "—" : value.toFixed(2);

const pct = (rate: number | null) =>
  rate === null ? "—" : `${(rate * 100).toFixed(2)}%`;

/** 被评人结果列表（TanStack Table）：总分/自评/分关系得分 + 完成率，行内下钻 */
export function ResultsTable({
  projectId,
  reviewees,
}: {
  projectId: string;
  reviewees: ResultRevieweeDTO[];
}) {
  const columns: ColumnDef<ResultRevieweeDTO>[] = [
    {
      header: "被评人",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-muted-foreground text-xs">
            {row.original.employeeNo}
            {row.original.department ? ` · ${row.original.department}` : ""}
          </p>
        </div>
      ),
    },
    { header: "岗位", cell: ({ row }) => row.original.position ?? "—" },
    { header: "职级", cell: ({ row }) => row.original.grade ?? "—" },
    {
      header: "360 总分",
      cell: ({ row }) => (
        <span className="font-medium">{score(row.original.totalScore)}</span>
      ),
    },
    { header: "自评", cell: ({ row }) => score(row.original.selfScore) },
    { header: "上级", cell: ({ row }) => score(row.original.managerScore) },
    { header: "平级", cell: ({ row }) => score(row.original.peerScore) },
    { header: "下级", cell: ({ row }) => score(row.original.subordinateScore) },
    {
      header: "完成率",
      cell: ({ row }) => (
        <span>
          {row.original.submittedCount}/{row.original.expectedCount}
          <span className="text-muted-foreground ml-1 text-xs">
            ({pct(row.original.completionRate)})
          </span>
        </span>
      ),
    },
    {
      header: "操作",
      cell: ({ row }) => (
        <Button asChild size="sm" variant="outline">
          <Link
            href={`/projects/${projectId}/results/${row.original.personId}`}
          >
            查看下钻
          </Link>
        </Button>
      ),
    },
  ];

  // TanStack Table v8 与 React Compiler 不兼容（官方已知限制），跳过编译
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: reviewees,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>被评人结果（{reviewees.length} 人）</CardTitle>
        <CardDescription>
          数据只读自冻结快照；点击「查看下钻」查看维度/题目得分与评价人明细
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
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
              {table.getRowModel().rows.map((row) => (
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
        </div>
      </CardContent>
    </Card>
  );
}
