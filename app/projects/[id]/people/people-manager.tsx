"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  PersonDTO,
  RelationDTO,
} from "@/modules/review-relations/service";

const RELATION_LABELS: Record<string, string> = {
  SELF: "自评",
  MANAGER: "上级",
  PEER: "平级",
  SUBORDINATE: "下级",
};

const TASK_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  SUBMITTED: "已提交",
  RETURNED: "已退回",
};

type PreviewData = {
  total: number;
  valid: number;
  errors: number;
  duplicates: number;
  conflicts: number;
  issues: { row: number; type: string; message: string }[];
};

/** HR 人员与关系管理：TanStack Table + Excel 导入向导（Preview → Commit）+ 手工增删改 */
export function PeopleManager({
  projectId,
  selfReviewEnabled,
  initialPeople,
  initialRelations,
}: {
  projectId: string;
  selfReviewEnabled: boolean;
  initialPeople: PersonDTO[];
  initialRelations: RelationDTO[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"relations" | "people">("relations");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const relationColumns: ColumnDef<RelationDTO>[] = [
    {
      header: "被评人",
      cell: ({ row }) => (
        <div>
          <p>{row.original.reviewee.name}</p>
          <p className="text-muted-foreground text-xs">
            {row.original.reviewee.employeeNo}
            {row.original.reviewee.department
              ? ` · ${row.original.reviewee.department}`
              : ""}
          </p>
        </div>
      ),
    },
    {
      header: "评价人",
      cell: ({ row }) => (
        <div>
          <p>{row.original.reviewer.name}</p>
          <p className="text-muted-foreground text-xs">
            {row.original.reviewer.employeeNo}
            {row.original.reviewer.department
              ? ` · ${row.original.reviewer.department}`
              : ""}
          </p>
        </div>
      ),
    },
    {
      header: "关系",
      cell: ({ row }) =>
        row.original.relationType === "SELF" ? (
          <Badge variant="secondary">自评</Badge>
        ) : (
          <select
            value={RELATION_LABELS[row.original.relationType]}
            onChange={(e) => handleChangeType(row.original, e.target.value)}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            aria-label="修改关系类型"
          >
            <option>上级</option>
            <option>平级</option>
            <option>下级</option>
          </select>
        ),
    },
    {
      header: "任务状态",
      cell: ({ row }) =>
        row.original.taskStatus ? (
          <Badge variant="outline">
            {TASK_STATUS_LABELS[row.original.taskStatus]}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      header: "状态",
      cell: ({ row }) =>
        row.original.active ? (
          <Badge>有效</Badge>
        ) : (
          <Badge variant="secondary">已移除</Badge>
        ),
    },
    {
      header: "操作",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => handleDeleteRelation(row.original)}
        >
          删除
        </Button>
      ),
    },
  ];

  const peopleColumns: ColumnDef<PersonDTO>[] = [
    { header: "工号", cell: ({ row }) => row.original.employeeNo },
    { header: "姓名", cell: ({ row }) => row.original.name },
    {
      header: "部门",
      cell: ({ row }) => row.original.department ?? "—",
    },
    { header: "岗位", cell: ({ row }) => row.original.position ?? "—" },
    { header: "职级", cell: ({ row }) => row.original.grade ?? "—" },
    {
      header: "被评次数",
      cell: ({ row }) =>
        row.original.revieweeCount > 0 ? row.original.revieweeCount : "—",
    },
    {
      header: "评价次数",
      cell: ({ row }) =>
        row.original.reviewerCount > 0 ? row.original.reviewerCount : "—",
    },
    {
      header: "自评",
      cell: ({ row }) => (row.original.hasSelfRelation ? "已生成" : "—"),
    },
  ];

  // TanStack Table v8 的 useReactTable 返回含函数的实例，与 React Compiler 的
  // 自动 memoization 不兼容（官方已知限制），跳过编译不影响正确性
  // eslint-disable-next-line react-hooks/incompatible-library
  const relationsTable = useReactTable({
    data: initialRelations,
    columns: relationColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  const peopleTable = useReactTable({
    data: initialPeople,
    columns: peopleColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.error ?? "操作失败"), { data });
    }
    return data;
  }

  function handlePreview() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("请先选择 .xlsx 文件");
      return;
    }
    void (async () => {
      setError(null);
      setMessage(null);
      setPreview(null);
      setLoading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const data = await api(
          `/api/projects/${projectId}/relations/import/preview`,
          { method: "POST", body: form },
        );
        setPreview(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }

  function handleCommit() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    void (async () => {
      setError(null);
      setMessage(null);
      setLoading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const data = await api(
          `/api/projects/${projectId}/relations/import/commit`,
          { method: "POST", body: form },
        );
        const r = data.result;
        setMessage(
          `导入完成：新增关系 ${r.relationsCreated}、更新 ${r.relationsUpdated}、移除 ${r.relationsDeleted + r.relationsDeactivated}、自动生成自评 ${r.selfRelationsCreated}`,
        );
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch (e) {
        const err = e as Error & {
          data?: { details?: { issues?: { row: number; message: string }[] } };
        };
        setError(err.message);
        const issues = err.data?.details?.issues;
        if (issues && issues.length > 0) {
          setError(
            `${err.message}：` +
              issues
                .slice(0, 10)
                .map((i) => `第 ${i.row} 行 ${i.message}`)
                .join("；"),
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }

  function handleDeleteRelation(relation: RelationDTO) {
    if (
      !window.confirm(
        `确定删除「${relation.reviewer.name} → ${relation.reviewee.name}（${RELATION_LABELS[relation.relationType]}）」？${relation.taskStatus === "SUBMITTED" || relation.taskStatus === "RETURNED" ? "已有提交：该评价将不再参与结果（历史保留）。" : ""}`,
      )
    ) {
      return;
    }
    void (async () => {
      setError(null);
      setMessage(null);
      try {
        const data = await api(`/api/relations/${relation.id}`, {
          method: "DELETE",
        });
        setMessage(
          data.deactivated
            ? "关系已删除（已有提交，评价不再参与结果，历史保留）"
            : "关系已删除",
        );
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }

  function handleChangeType(relation: RelationDTO, newLabel: string) {
    void (async () => {
      setError(null);
      setMessage(null);
      try {
        await api(`/api/relations/${relation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relationType: newLabel }),
        });
        setMessage("关系类型已更新");
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Excel 导入（两阶段）</CardTitle>
          <CardDescription>
            先预检查（总行数 / 有效 / 错误 / 重复 / 冲突），确认无误后正式导入。
            正式导入为整体替换：Excel 之外的旧关系将被移除
            {selfReviewEnabled ? "；新被评人的自评关系自动生成" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/projects/${projectId}/relations/template`}
              className="text-primary text-sm underline-offset-4 hover:underline"
            >
              下载 Excel 模板
            </a>
            <span className="text-muted-foreground text-xs">
              8 个标准字段（PRD 16.1），每行一条评价关系
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="text-sm"
              aria-label="关系 Excel 文件"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handlePreview}
              disabled={loading}
            >
              {loading ? "检查中…" : "预检查"}
            </Button>
          </div>

          {preview && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span>总行数：{preview.total}</span>
                <span className="text-emerald-600">有效：{preview.valid}</span>
                {preview.errors > 0 && (
                  <span className="text-destructive">
                    错误：{preview.errors}
                  </span>
                )}
                {preview.duplicates > 0 && (
                  <span className="text-amber-600">
                    重复：{preview.duplicates}
                  </span>
                )}
                {preview.conflicts > 0 && (
                  <span className="text-destructive">
                    冲突：{preview.conflicts}
                  </span>
                )}
              </div>
              {preview.issues.length > 0 && (
                <ul className="text-muted-foreground max-h-40 space-y-1 overflow-y-auto text-xs">
                  {preview.issues.map((issue, i) => (
                    <li key={i}>
                      第 {issue.row} 行（
                      {issue.type === "error"
                        ? "错误"
                        : issue.type === "duplicate"
                          ? "重复"
                          : "冲突"}
                      ）：{issue.message}
                    </li>
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                onClick={handleCommit}
                disabled={
                  loading || preview.errors > 0 || preview.conflicts > 0
                }
              >
                确认导入（{preview.valid} 条有效关系）
              </Button>
              {(preview.errors > 0 || preview.conflicts > 0) && (
                <p className="text-destructive text-xs">
                  存在错误或冲突行，请修正 Excel 后重新上传
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="数据视图"
      >
        {(
          [
            [
              "relations",
              `关系列表（${initialRelations.filter((r) => r.active).length}）`,
            ],
            ["people", `人员列表（${initialPeople.length}）`],
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

      {error && (
        <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          {message}
        </p>
      )}

      {tab === "relations" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              评价关系
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                {showAddForm ? "收起" : "手工新增关系"}
              </Button>
            </CardTitle>
            <CardDescription>
              关系从被评人视角定义；已有提交仍可调整（PRD 第 20 节）
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {showAddForm && (
              <AddRelationForm
                projectId={projectId}
                onDone={(msg) => {
                  setShowAddForm(false);
                  setMessage(msg);
                  router.refresh();
                }}
                onError={setError}
              />
            )}
            <Table>
              <TableHeader>
                {relationsTable.getHeaderGroups().map((group) => (
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
                {relationsTable.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={row.original.active ? "" : "opacity-50"}
                  >
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
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>项目人员</CardTitle>
            <CardDescription>
              项目时点快照：修改本项目中的人员信息不影响其他项目历史记录
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                {peopleTable.getHeaderGroups().map((group) => (
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
                {peopleTable.getRowModel().rows.map((row) => (
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 手工新增关系表单（PRD 第 20 节） */
function AddRelationForm({
  projectId,
  onDone,
  onError,
}: {
  projectId: string;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    revieweeEmployeeNo: "",
    revieweeName: "",
    revieweeDepartment: "",
    revieweePosition: "",
    revieweeGrade: "",
    reviewerEmployeeNo: "",
    reviewerName: "",
    relationType: "上级",
  });
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/relations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          onError(data.error ?? "新增失败");
          return;
        }
        onDone("关系已新增（新被评人自动生成自评）");
      } catch {
        onError("网络错误，请重试");
      } finally {
        setLoading(false);
      }
    })();
  }

  const fields: [keyof typeof form, string][] = [
    ["revieweeEmployeeNo", "被评人工号 *"],
    ["revieweeName", "被评人姓名"],
    ["revieweeDepartment", "被评人部门"],
    ["revieweePosition", "被评人岗位"],
    ["revieweeGrade", "被评人职级"],
    ["reviewerEmployeeNo", "评价人工号 *"],
    ["reviewerName", "评价人姓名 *"],
  ];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(([key, label]) => (
          <div key={key} className="space-y-1">
            <label htmlFor={`add-relation-${key}`} className="text-xs">
              {label}
            </label>
            <Input
              id={`add-relation-${key}`}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
              className="h-8"
            />
          </div>
        ))}
        <div className="space-y-1">
          <label htmlFor="add-relation-type" className="text-xs">
            关系 *
          </label>
          <select
            id="add-relation-type"
            value={form.relationType}
            onChange={(e) => set("relationType", e.target.value)}
            className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm"
          >
            <option>上级</option>
            <option>平级</option>
            <option>下级</option>
          </select>
        </div>
      </div>
      <Button size="sm" onClick={submit} disabled={loading}>
        {loading ? "提交中…" : "新增"}
      </Button>
    </div>
  );
}
