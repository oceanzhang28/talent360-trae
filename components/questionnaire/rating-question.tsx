"use client";

import type { TaskQuestion } from "@/modules/review-tasks/validate";

/**
 * 量表题组件（PRD 第 10、11 节）：固定 10 档单选（0.5~5.0），
 * 显示项目自定义 label；必答不可空（提交校验在服务端，前端同步提示）。
 * 手机优先：档位按钮两行五列网格，PC 一行十列。
 */
export function RatingQuestion({
  question,
  scales,
  value,
  disabled,
  onChange,
}: {
  question: TaskQuestion;
  scales: Array<{ value: number; label: string }>;
  value: number | null;
  disabled: boolean;
  onChange: (score: number) => void;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="w-full disabled:cursor-not-allowed"
      data-testid={`rating-${question.code}`}
    >
      <legend className="sr-only">{question.title}</legend>
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {scales.map((scale) => {
          const selected = value === scale.value;
          return (
            <button
              key={scale.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(scale.value)}
              className={`flex flex-col items-center gap-0.5 rounded-md border px-1 py-2 text-center transition-colors ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent border-input bg-background"
              } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <span className="text-sm font-semibold">
                {scale.value.toFixed(1)}
              </span>
              <span
                className={`text-[10px] leading-tight ${
                  selected ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {scale.label}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
