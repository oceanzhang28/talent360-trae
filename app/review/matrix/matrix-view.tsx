"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { RatingCell } from "@/components/matrix-review/rating-cell";
import { RatingQuestion } from "@/components/questionnaire/rating-question";
import { TextQuestion } from "@/components/questionnaire/text-question";
import {
  useDraftAutosave,
  type AnswerValue,
} from "@/components/review/use-draft-autosave";
import type {
  MyMatrixDTO,
  MatrixGroupDTO,
  MatrixTaskDTO,
} from "@/modules/review-tasks/service";
import type { RelationType } from "@/app/generated/prisma/client";
import {
  flattenDimensionQuestions,
  type TaskQuestion,
} from "@/modules/review-tasks/validate";

/**
 * 矩阵评价视图（PRD 第 24.2 节 / 技术文档第 50、51 节）。
 * - PC：TanStack Table（行=被评人，列=当前维度题目）
 * - 移动端：「当前维度 → 当前题目 → 人员卡片」卡片流（禁止整表缩放）
 * - 单元格与单人模式共用同一 DraftAnswer（taskId + questionId），实时互通
 * - 切关系 / 切单人 / 批量提交前先 flush 草稿落库（草稿不丢）
 */

const RELATION_ORDER: RelationType[] = [
  "SELF",
  "MANAGER",
  "PEER",
  "SUBORDINATE",
];

const RELATION_LABELS: Record<RelationType, string> = {
  SELF: "自评",
  MANAGER: "上级",
  PEER: "平级",
  SUBORDINATE: "下级",
};

const STATUS_LABELS: Record<MatrixTaskDTO["status"], string> = {
  NOT_STARTED: "待评价",
  IN_PROGRESS: "进行中",
  SUBMITTED: "已完成",
  RETURNED: "已退回",
};

function statusBadge(status: MatrixTaskDTO["status"]) {
  const cls =
    status === "SUBMITTED"
      ? "bg-emerald-100 text-emerald-800"
      : status === "RETURNED"
        ? "bg-amber-100 text-amber-800"
        : status === "IN_PROGRESS"
          ? "bg-blue-100 text-blue-800"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function MatrixView({
  data,
  initialDimension,
}: {
  data: MyMatrixDTO;
  initialDimension: string | null;
}) {
  const router = useRouter();
  const [projectIdx, setProjectIdx] = useState(0);
  const [dimensionName, setDimensionName] = useState(initialDimension ?? "");
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const map: Record<string, AnswerValue> = {};
    for (const g of data.groups) {
      for (const t of g.tasks) {
        for (const d of t.drafts) {
          map[`${t.taskId}:${d.questionId}`] = {
            score: d.score,
            textValue: d.textValue,
          };
        }
      }
    }
    return map;
  });
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    submitted: number;
    skipped: Array<{
      revieweeName: string;
      reason: string;
      missing?: Array<{ code: string }>;
    }>;
  } | null>(null);

  const { saveState, savedAt, update, flush, clearTimer } = useDraftAutosave();

  const group: MatrixGroupDTO | undefined = data.groups[projectIdx];
  const dimension =
    group?.dimensions.find((d) => d.name === dimensionName) ??
    group?.dimensions[0];
  const questions: TaskQuestion[] = dimension
    ? flattenDimensionQuestions(dimension)
    : [];
  const editableTasks = useMemo(
    () => (group ? group.tasks.filter((t) => t.editable) : []),
    [group],
  );

  /** 切换前先落库草稿（切关系 / 切单人 / 刷新数据都走这里） */
  const navigate = useCallback(
    async (href: string) => {
      setSwitchError(null);
      clearTimer();
      const flushed = await flush();
      if (!flushed) {
        setSwitchError("草稿保存失败，请检查网络后重试");
        return;
      }
      router.push(href);
    },
    [clearTimer, flush, router],
  );

  const updateAnswer = useCallback(
    (taskId: string, questionId: string, value: AnswerValue) => {
      setAnswers((prev) => ({ ...prev, [`${taskId}:${questionId}`]: value }));
      update(taskId, questionId, value);
    },
    [update],
  );

  /** 维度分页（本地切换 + replaceState 同步 URL，不触发重新请求以免丢编辑中数据） */
  const selectDimension = useCallback((name: string) => {
    setDimensionName(name);
    setSelectedQuestionId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("dimension", name);
    window.history.replaceState(null, "", url.toString());
  }, []);

  /** 批量提交当前项目组所有可编辑任务（服务端跳过必答不全的并返回原因） */
  const handleBatchSubmit = useCallback(async () => {
    if (!group || editableTasks.length === 0 || batchSubmitting) return;
    setBatchSubmitting(true);
    setSwitchError(null);
    setBatchResult(null);
    try {
      clearTimer();
      const flushed = await flush();
      if (!flushed) {
        setSwitchError("草稿保存失败，请检查网络后重试");
        return;
      }
      const res = await fetch("/api/tasks/batch-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskIds: editableTasks.map((t) => t.taskId),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSwitchError(err.error ?? "批量提交失败，请稍后重试");
        return;
      }
      const result = (await res.json()) as {
        submitted: unknown[];
        skipped: {
          revieweeName: string;
          reason: string;
          missing?: Array<{ code: string }>;
        }[];
      };
      setBatchResult({
        submitted: result.submitted.length,
        skipped: result.skipped,
      });
      router.refresh();
    } finally {
      setBatchSubmitting(false);
    }
  }, [batchSubmitting, clearTimer, editableTasks, flush, group, router]);

  // ---------- TanStack Table（PC 矩阵表） ----------

  const columns: ColumnDef<MatrixTaskDTO>[] = useMemo(() => {
    if (!group) return [];
    const cols: ColumnDef<MatrixTaskDTO>[] = [
      {
        header: "被评人",
        cell: ({ row }) => {
          const task = row.original;
          return (
            <div className="min-w-[8.5rem]">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="hover:text-primary truncate font-medium underline-offset-2 hover:underline"
                  onClick={() => void navigate(`/review/${task.taskId}`)}
                >
                  {task.reviewee.name}
                </button>
                {statusBadge(task.status)}
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {task.reviewee.employeeNo}
              </p>
            </div>
          );
        },
      },
      ...questions.map((q): ColumnDef<MatrixTaskDTO> => ({
        id: q.id,
        header: () => (
          <div className="max-w-[14rem] min-w-[10.5rem]">
            <p className="font-mono text-xs">{q.code}</p>
            <p
              className="text-muted-foreground truncate text-xs font-normal"
              title={q.title}
            >
              {q.title}
            </p>
          </div>
        ),
        cell: ({ row }) => (
          <MatrixAnswerCell
            task={row.original}
            question={q}
            scales={group.scales}
            value={
              answers[`${row.original.taskId}:${q.id}`] ?? {
                score: null,
                textValue: null,
              }
            }
            onChange={updateAnswer}
          />
        ),
      })),
    ];
    return cols;
  }, [answers, group, navigate, questions, updateAnswer]);

  const table = useReactTable({
    data: group?.tasks ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const saveStatusText =
    saveState === "saving"
      ? "保存中…"
      : saveState === "error"
        ? "自动保存失败，请检查网络"
        : saveState === "saved" || savedAt
          ? `已自动保存 ${savedAt ?? ""}`
          : "作答后自动保存";

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 pb-28 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">矩阵评价</h1>
          <p className="text-muted-foreground text-sm">
            {RELATION_LABELS[data.relationType]}评价 · 行=被评人，列=题目
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void navigate("/review")}
          data-testid="back-to-list"
        >
          返回列表
        </Button>
      </div>

      {/* 关系切换 tab */}
      <div
        className="flex gap-1 overflow-x-auto"
        role="tablist"
        aria-label="评价关系"
        data-testid="relation-tabs"
      >
        {RELATION_ORDER.map((rel) => {
          const count = data.relationCounts[rel];
          const active = data.relationType === rel;
          return (
            <button
              key={rel}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={count === 0 && !active}
              onClick={() => void navigate(`/review/matrix?relation=${rel}`)}
              className={`shrink-0 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent disabled:opacity-40"
              }`}
            >
              {RELATION_LABELS[rel]}（{count}）
            </button>
          );
        })}
      </div>

      {switchError && (
        <div
          data-testid="switch-error"
          className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
        >
          {switchError}
        </div>
      )}

      {batchResult && (
        <div
          data-testid="batch-result"
          className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          <p>批量提交完成：成功 {batchResult.submitted} 份</p>
          {batchResult.skipped.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {batchResult.skipped.map((s, i) => (
                <li key={i}>
                  {s.revieweeName}：{s.reason}
                  {s.missing && s.missing.length > 0
                    ? `（${s.missing.map((m) => m.code).join("、")}）`
                    : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!group ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            该关系下暂无评价任务。
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 项目切换（多项目时） */}
          {data.groups.length > 1 && (
            <div className="flex gap-1 overflow-x-auto" aria-label="项目">
              {data.groups.map((g, i) => (
                <button
                  key={g.project.id}
                  type="button"
                  aria-pressed={i === projectIdx}
                  onClick={() => setProjectIdx(i)}
                  className={`shrink-0 rounded-md border px-3 py-1 text-xs transition-colors ${
                    i === projectIdx
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {g.project.name}
                </button>
              ))}
            </div>
          )}

          <p className="text-muted-foreground text-xs">
            {group.project.name}
            {group.project.status !== "ACTIVE" &&
              ` · 项目已${group.project.status === "CLOSED" ? "截止" : "冻结"}，内容只读`}
            {group.project.endAt
              ? ` · 截止 ${new Date(group.project.endAt).toLocaleDateString("zh-CN")}`
              : ""}
          </p>

          {/* 维度分页 tab + 批量提交（PC） */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex flex-1 gap-1 overflow-x-auto"
              aria-label="维度"
            >
              {group.dimensions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={dimension?.id === d.id}
                  onClick={() => selectDimension(d.name)}
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    dimension?.id === d.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            {editableTasks.length > 0 && (
              <Button
                size="sm"
                className="hidden md:inline-flex"
                onClick={() => void handleBatchSubmit()}
                disabled={batchSubmitting}
                data-testid="batch-submit"
              >
                {batchSubmitting
                  ? "提交中…"
                  : `批量提交（${editableTasks.length} 人）`}
              </Button>
            )}
          </div>

          {/* PC：TanStack Table 矩阵表（横向滚动，禁止整表缩放） */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="matrix-table"
          >
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id} className="align-top">
                        {h.isPlaceholder
                          ? null
                          : flexRender(
                              h.column.columnDef.header,
                              h.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-muted-foreground py-8 text-center text-sm"
                    >
                      当前维度下没有适用题目
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
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
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* 移动端：当前维度 → 当前题目 → 人员卡片（禁止整表缩放） */}
          <div className="space-y-3 md:hidden" data-testid="matrix-cards">
            <label className="block space-y-1">
              <span className="text-sm font-medium">当前题目</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                aria-label="选择题目"
                data-testid="question-select"
                value={
                  questions.find((q) => q.id === selectedQuestionId)?.id ??
                  questions[0]?.id ??
                  ""
                }
                onChange={(e) => setSelectedQuestionId(e.target.value)}
              >
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.code} · {q.title}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const q =
                questions.find((x) => x.id === selectedQuestionId) ??
                questions[0];
              if (!q) {
                return (
                  <Card>
                    <CardContent className="text-muted-foreground py-8 text-center text-sm">
                      当前维度下没有适用题目
                    </CardContent>
                  </Card>
                );
              }
              return group.tasks.map((task) => {
                const value = answers[`${task.taskId}:${q.id}`] ?? {
                  score: null,
                  textValue: null,
                };
                return (
                  <Card
                    key={task.taskId}
                    data-person={task.reviewee.employeeNo}
                  >
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate font-medium">
                            {task.reviewee.name}
                          </p>
                          {statusBadge(task.status)}
                        </div>
                        <button
                          type="button"
                          className="text-primary shrink-0 text-xs underline-offset-2 hover:underline"
                          onClick={() =>
                            void navigate(`/review/${task.taskId}`)
                          }
                        >
                          单人模式
                        </button>
                      </div>
                      {q.type === "RATING" ? (
                        <RatingQuestion
                          question={q}
                          scales={group.scales}
                          value={value.score}
                          disabled={!task.editable}
                          onChange={(score) =>
                            updateAnswer(task.taskId, q.id, {
                              score,
                              textValue: null,
                            })
                          }
                        />
                      ) : (
                        <TextQuestion
                          question={q}
                          value={value.textValue}
                          disabled={!task.editable}
                          onChange={(text) =>
                            updateAnswer(task.taskId, q.id, {
                              score: null,
                              textValue: text,
                            })
                          }
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              });
            })()}
          </div>

          {/* 移动端吸底操作栏 */}
          <div className="bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t p-3 backdrop-blur md:hidden">
            <div className="flex items-center justify-between gap-3">
              <span
                className="text-muted-foreground min-w-0 truncate text-xs"
                data-testid="save-status-mobile"
              >
                {saveStatusText}
              </span>
              {editableTasks.length > 0 ? (
                <Button
                  size="sm"
                  onClick={() => void handleBatchSubmit()}
                  disabled={batchSubmitting}
                  data-testid="batch-submit-mobile"
                >
                  {batchSubmitting
                    ? "提交中…"
                    : `批量提交（${editableTasks.length} 人）`}
                </Button>
              ) : (
                <Badge variant="secondary">只读</Badge>
              )}
            </div>
          </div>

          {/* PC 保存状态 */}
          <p
            className="text-muted-foreground hidden text-xs md:block"
            data-testid="save-status-pc"
          >
            {saveStatusText}
          </p>
        </>
      )}
    </main>
  );
}

/** 矩阵单元格：可编辑 → 紧凑评分组 / 文本框；只读 → 显示值 */
function MatrixAnswerCell({
  task,
  question,
  scales,
  value,
  onChange,
}: {
  task: MatrixTaskDTO;
  question: TaskQuestion;
  scales: MatrixGroupDTO["scales"];
  value: AnswerValue;
  onChange: (taskId: string, questionId: string, value: AnswerValue) => void;
}) {
  if (!task.editable) {
    return (
      <div className="min-w-[10.5rem] text-sm">
        {question.type === "RATING" ? (
          value.score !== null ? (
            <Badge variant="secondary">{value.score.toFixed(1)}</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          )
        ) : value.textValue ? (
          <p className="max-w-[16rem] text-xs leading-relaxed whitespace-pre-wrap">
            {value.textValue}
          </p>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>
    );
  }
  if (question.type === "RATING") {
    return (
      <RatingCell
        question={question}
        scales={scales}
        value={value.score}
        disabled={false}
        testId={`cell-${task.reviewee.employeeNo}-${question.code}`}
        onChange={(score) =>
          onChange(task.taskId, question.id, { score, textValue: null })
        }
      />
    );
  }
  return (
    <Textarea
      value={value.textValue ?? ""}
      maxLength={2000}
      rows={2}
      placeholder={question.required ? "必填" : "选填"}
      aria-label={`${task.reviewee.name} ${question.code}`}
      data-testid={`cell-${task.reviewee.employeeNo}-${question.code}`}
      onChange={(e) =>
        onChange(task.taskId, question.id, {
          score: null,
          textValue: e.target.value,
        })
      }
      className="min-w-[12rem] resize-y"
    />
  );
}
