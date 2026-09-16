"use client";

import { Textarea } from "@/components/ui/textarea";
import type { TaskQuestion } from "@/modules/review-tasks/validate";

/** 开放题组件（PRD 第 11 节）：必填/选填由问卷配置；必填校验提交时统一执行 */
export function TextQuestion({
  question,
  value,
  disabled,
  onChange,
}: {
  question: TaskQuestion;
  value: string | null;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <Textarea
      value={value ?? ""}
      disabled={disabled}
      required={question.required}
      maxLength={2000}
      rows={3}
      placeholder={question.required ? "必填" : "选填"}
      aria-label={question.title}
      data-testid={`text-${question.code}`}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y"
    />
  );
}
