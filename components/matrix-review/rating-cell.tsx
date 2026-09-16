"use client";

import type { TaskQuestion } from "@/modules/review-tasks/validate";

/**
 * 矩阵模式 PC 表格的紧凑评分单元格：10 档两行五列小按钮（只显示分数）。
 * 与单人模式 RatingQuestion 语义一致（同一 DraftAnswer），仅布局更紧凑。
 */
export function RatingCell({
  question,
  scales,
  value,
  disabled,
  onChange,
  testId,
}: {
  question: TaskQuestion;
  scales: Array<{ value: number; label: string }>;
  value: number | null;
  disabled: boolean;
  onChange: (score: number) => void;
  testId: string;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="w-full min-w-[10.5rem] disabled:cursor-not-allowed"
      data-testid={testId}
    >
      <legend className="sr-only">{question.title}</legend>
      <div className="grid w-max grid-cols-5 gap-1">
        {scales.map((scale) => {
          const selected = value === scale.value;
          return (
            <button
              key={scale.value}
              type="button"
              aria-pressed={selected}
              title={scale.label}
              onClick={() => onChange(scale.value)}
              className={`h-7 w-8 rounded-md border text-center text-xs font-medium transition-colors ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent border-input bg-background"
              } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              {scale.value.toFixed(1)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
