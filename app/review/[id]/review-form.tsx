"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useDraftAutosave,
  type AnswerValue,
} from "@/components/review/use-draft-autosave";
import { RatingQuestion } from "@/components/questionnaire/rating-question";
import { TextQuestion } from "@/components/questionnaire/text-question";
import type {
  TaskDetailDTO,
  DraftAnswerDTO,
} from "@/modules/review-tasks/service";
import type {
  TaskDimension,
  TaskQuestion,
} from "@/modules/review-tasks/validate";

/**
 * 评价填写表单（单人模式，手机优先纵向布局）。
 * - 自动保存：useDraftAutosave（debounce 1.5s，只提交变化字段，与矩阵模式共用）
 * - 提交：先落库未保存草稿，再 POST submit；必答缺失高亮提示
 * - SUBMITTED / 项目非 ACTIVE → 只读查看
 */

const RELATION_LABELS: Record<string, string> = {
  SELF: "自评",
  MANAGER: "上级评价",
  PEER: "平级评价",
  SUBORDINATE: "下级评价",
};

export function ReviewForm({
  detail,
  initialAnswers,
}: {
  detail: TaskDetailDTO;
  initialAnswers: DraftAnswerDTO[];
}) {
  const router = useRouter();
  const editable = detail.task.editable;

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const map: Record<string, AnswerValue> = {};
    for (const a of initialAnswers) {
      map[a.questionId] = { score: a.score, textValue: a.textValue };
    }
    return map;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [missingCodes, setMissingCodes] = useState<string[]>([]);
  const [switching, setSwitching] = useState(false);

  const { saveState, savedAt, update, flush, clearTimer } = useDraftAutosave();

  const updateAnswer = useCallback(
    (questionId: string, value: AnswerValue) => {
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
      if (!editable) return;
      update(detail.task.id, questionId, value);
    },
    [detail.task.id, editable, update],
  );

  const missingSet = useMemo(() => new Set(missingCodes), [missingCodes]);

  /** 切矩阵模式：先落库未保存草稿再跳转（草稿不丢） */
  const handleSwitchToMatrix = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    setSubmitError(null);
    try {
      clearTimer();
      const flushed = await flush();
      if (!flushed) {
        setSubmitError("草稿保存失败，请检查网络后重试");
        return;
      }
      router.push(`/review/matrix?relation=${detail.relationType}`);
    } finally {
      setSwitching(false);
    }
  }, [clearTimer, detail.relationType, flush, router, switching]);

  const handleSubmit = useCallback(async () => {
    if (!editable || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setMissingCodes([]);
    try {
      clearTimer();
      const flushed = await flush();
      if (!flushed) {
        setSubmitError("草稿保存失败，请检查网络后重试");
        return;
      }
      const res = await fetch(`/api/tasks/${detail.task.id}/submit`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: { missing?: Array<{ code: string; title: string }> };
      };
      if (res.status === 400 && data.details?.missing) {
        setMissingCodes(data.details.missing.map((m) => m.code));
        setSubmitError("必答项未完成，请填写标红的题目后重试");
      } else {
        setSubmitError(data.error ?? "提交失败，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  }, [clearTimer, detail.task.id, editable, flush, router, submitting]);

  const saveStatusText = !editable
    ? ""
    : saveState === "saving"
      ? "保存中…"
      : saveState === "error"
        ? "自动保存失败，请检查网络"
        : saveState === "saved" || savedAt
          ? `已自动保存 ${savedAt ?? ""}`
          : "作答后自动保存";

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-4 pb-28 sm:p-6">
      {/* 被评人信息 */}
      <Card>
        <CardContent className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-bold">
              {detail.reviewee.name}
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {detail.relationType === "SELF"
                  ? "自评"
                  : `${RELATION_LABELS[detail.relationType]} · 被评人`}
              </span>
            </h1>
            <Badge variant="outline">
              {RELATION_LABELS[detail.relationType]}
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs">
            {detail.project.name} · 工号 {detail.reviewee.employeeNo}
            {detail.reviewee.department
              ? ` · ${detail.reviewee.department}`
              : ""}
            {detail.project.endAt
              ? ` · 截止 ${new Date(detail.project.endAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}`
              : ""}
          </p>
          {detail.project.instruction && (
            <p className="bg-muted mt-2 rounded-md p-2.5 text-xs leading-relaxed">
              {detail.project.instruction}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-1 w-full sm:w-auto"
            onClick={() => void handleSwitchToMatrix()}
            disabled={switching}
            data-testid="switch-to-matrix"
          >
            {switching ? "切换中…" : "切换矩阵模式"}
          </Button>
        </CardContent>
      </Card>

      {/* 状态横幅 */}
      {detail.task.status === "SUBMITTED" && (
        <div
          data-testid="submitted-banner"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          已提交（第 {detail.task.currentSubmissionVersion} 版）
          {detail.task.submittedAt
            ? ` · ${new Date(detail.task.submittedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}`
            : ""}
          ，内容只读。如需修改请联系项目管理员退回。
        </div>
      )}
      {detail.task.status === "RETURNED" && (
        <div
          data-testid="returned-banner"
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          项目管理员已退回此评价，请修改后重新提交（重新提交将生成新版本）。
        </div>
      )}
      {submitError && (
        <div
          data-testid="submit-error"
          className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
        >
          {submitError}
        </div>
      )}

      {/* 问卷（纵向布局，手机优先） */}
      {detail.dimensions.map((dim) => (
        <QuestionDimension
          key={dim.id}
          dim={dim}
          answers={answers}
          scales={detail.scales}
          disabled={!editable}
          missingSet={missingSet}
          onChange={updateAnswer}
        />
      ))}

      {/* 底部操作栏（吸底，PC/手机一致） */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t p-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <span className="text-muted-foreground min-w-0 truncate text-xs">
            {saveStatusText}
          </span>
          {editable ? (
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? "提交中…" : "提交评价"}
            </Button>
          ) : (
            <Badge variant="secondary">只读</Badge>
          )}
        </div>
      </div>
    </main>
  );
}

function QuestionDimension({
  dim,
  nested,
  answers,
  scales,
  disabled,
  missingSet,
  onChange,
}: {
  dim: TaskDimension;
  nested?: boolean;
  answers: Record<string, AnswerValue>;
  scales: TaskDetailDTO["scales"];
  disabled: boolean;
  missingSet: Set<string>;
  onChange: (questionId: string, value: AnswerValue) => void;
}) {
  return (
    <Card>
      <CardContent className={nested ? "space-y-3 pt-2" : "space-y-3"}>
        <div className="flex items-baseline gap-2">
          <h2
            className={
              nested ? "text-sm font-semibold" : "text-base font-semibold"
            }
          >
            {dim.name}
          </h2>
        </div>
        {dim.description && (
          <p className="text-muted-foreground text-xs">{dim.description}</p>
        )}
        {dim.questions.map((q) => (
          <QuestionItem
            key={q.id}
            question={q}
            value={answers[q.id] ?? { score: null, textValue: null }}
            scales={scales}
            disabled={disabled}
            missing={missingSet.has(q.code)}
            onChange={onChange}
          />
        ))}
        {dim.children.map((child) => (
          <div key={child.id} className="rounded-md border p-3">
            <QuestionDimension
              dim={child}
              nested
              answers={answers}
              scales={scales}
              disabled={disabled}
              missingSet={missingSet}
              onChange={onChange}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function QuestionItem({
  question,
  value,
  scales,
  disabled,
  missing,
  onChange,
}: {
  question: TaskQuestion;
  value: AnswerValue;
  scales: TaskDetailDTO["scales"];
  disabled: boolean;
  missing: boolean;
  onChange: (questionId: string, value: AnswerValue) => void;
}) {
  return (
    <div
      className={`space-y-2 rounded-md border p-3 ${
        missing ? "border-destructive bg-destructive/5" : "border-border"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground shrink-0 pt-0.5 font-mono text-xs">
          {question.code}
        </span>
        <p className="min-w-0 flex-1 text-sm leading-snug font-medium">
          {question.title}
        </p>
        <Badge variant="outline" className="shrink-0">
          {question.type === "RATING"
            ? "必答"
            : question.required
              ? "必填"
              : "选填"}
        </Badge>
      </div>
      {question.description && (
        <p className="text-muted-foreground text-xs">{question.description}</p>
      )}
      {question.type === "RATING" ? (
        <RatingQuestion
          question={question}
          scales={scales}
          value={value.score}
          disabled={disabled}
          onChange={(score) =>
            onChange(question.id, { score, textValue: null })
          }
        />
      ) : (
        <TextQuestion
          question={question}
          value={value.textValue}
          disabled={disabled}
          onChange={(text) =>
            onChange(question.id, { score: null, textValue: text })
          }
        />
      )}
    </div>
  );
}
