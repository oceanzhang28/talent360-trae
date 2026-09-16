"use client";

import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ALL_TRUE,
  REL_FLAGS,
  childrenOf,
  questionsOf,
  type Dim,
  type EditorState,
  type Q,
} from "./editor-model";

/**
 * 编辑器展示组件（维度块 + 题目行）：拆成独立组件是为了满足 Hooks 规则——
 * 拖拽需要 `useSortable` / `useDroppable`，不能在 render 函数或循环里调用。
 */

export type EditorActions = {
  toggleExpand: (key: string) => void;
  isExpanded: (key: string) => boolean;
  updateDim: (key: string, patch: Partial<Dim>) => void;
  removeDim: (key: string) => void;
  duplicateDim: (key: string) => void;
  moveDim: (key: string, delta: -1 | 1) => void;
  addQuestion: (dimensionKey: string) => void;
  addChildDim: (parentKey: string) => void;
  updateQuestion: (key: string, patch: Partial<Q>, merge?: boolean) => void;
  duplicateQuestion: (key: string) => void;
  removeQuestions: (keys: string[]) => void;
  moveQuestion: (key: string, delta: -1 | 1) => void;
  selected: Set<string>;
  toggleSelect: (key: string) => void;
  /** 可作为题目挂载点的维度：二级维度，或尚无二级维度的一级维度 */
  questionTargets: Dim[];
};

/** 拖拽把手：把 dnd-kit 的 listeners/attributes 挂在把手而非整行，避免和输入框抢事件 */
function DragHandle({
  label,
  testId,
  attributes,
  listeners,
  isDragging,
}: {
  label: string;
  testId: string;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  isDragging: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      className={`text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none rounded px-1 text-base leading-none ${
        isDragging ? "cursor-grabbing" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  );
}

function dragStyle(
  transform: { x: number; y: number } | null,
  transition: string | undefined,
  isDragging: boolean,
): React.CSSProperties {
  return {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
    position: isDragging ? "relative" : undefined,
    zIndex: isDragging ? 10 : undefined,
  };
}

export function SortableQuestion({
  question,
  index,
  total,
  actions,
  usesTargets,
}: {
  question: Q;
  index: number;
  total: number;
  actions: EditorActions;
  usesTargets: Dim[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: question.key,
    data: { type: "question", dimensionKey: question.dimensionKey },
  });

  const q = question;

  return (
    <div
      ref={setNodeRef}
      style={dragStyle(transform, transition, isDragging)}
      className="bg-background flex flex-wrap items-end gap-2 rounded border px-2 py-2"
      data-testid={`question-${q.code || q.key}`}
    >
      <input
        type="checkbox"
        className="mb-2 size-4"
        aria-label={`选择题目 ${q.code}`}
        checked={actions.selected.has(q.key)}
        onChange={() => actions.toggleSelect(q.key)}
      />
      <DragHandle
        label={`拖动题目 ${q.code}`}
        testId={`drag-${q.code || q.key}`}
        attributes={attributes as unknown as Record<string, unknown>}
        listeners={listeners as unknown as Record<string, unknown> | undefined}
        isDragging={isDragging}
      />
      <div className="w-20 space-y-1">
        <Label htmlFor={`q-code-${q.key}`}>编号</Label>
        <Input
          id={`q-code-${q.key}`}
          className="h-8"
          value={q.code}
          onChange={(e) =>
            actions.updateQuestion(q.key, { code: e.target.value })
          }
        />
      </div>
      <div className="w-24 space-y-1">
        <Label htmlFor={`q-type-${q.key}`}>题型</Label>
        <select
          id={`q-type-${q.key}`}
          className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm"
          value={q.type}
          onChange={(e) =>
            actions.updateQuestion(q.key, {
              type: e.target.value === "TEXT" ? "TEXT" : "RATING",
            })
          }
        >
          <option value="RATING">量表</option>
          <option value="TEXT">开放题</option>
        </select>
      </div>
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor={`q-title-${q.key}`}>题干</Label>
        <Input
          id={`q-title-${q.key}`}
          className="h-8"
          value={q.title}
          onChange={(e) =>
            actions.updateQuestion(q.key, { title: e.target.value })
          }
        />
      </div>
      <div className="w-20 space-y-1">
        <Label htmlFor={`q-weight-${q.key}`}>权重%</Label>
        <Input
          id={`q-weight-${q.key}`}
          className="h-8"
          inputMode="decimal"
          disabled={q.type === "TEXT"}
          value={q.type === "TEXT" ? "" : q.weight}
          onChange={(e) =>
            actions.updateQuestion(q.key, { weight: e.target.value })
          }
        />
      </div>
      <label
        className="mb-1 flex items-center gap-1 text-xs"
        htmlFor={`q-required-${q.key}`}
      >
        <input
          id={`q-required-${q.key}`}
          type="checkbox"
          className="size-4"
          disabled={q.type === "RATING"}
          checked={q.type === "RATING" ? true : q.required}
          onChange={(e) =>
            actions.updateQuestion(q.key, { required: e.target.checked })
          }
        />
        必答
      </label>
      <label
        className="mb-1 flex items-center gap-1 text-xs"
        htmlFor={`q-override-${q.key}`}
      >
        <input
          id={`q-override-${q.key}`}
          type="checkbox"
          className="size-4"
          checked={q.override}
          onChange={(e) =>
            actions.updateQuestion(q.key, { override: e.target.checked })
          }
        />
        覆盖维度适用关系
      </label>
      {q.override && (
        <div className="mb-1 flex items-center gap-1">
          {REL_FLAGS.map((flag) => (
            <button
              key={flag.key}
              type="button"
              title={flag.label}
              aria-pressed={q.rel[flag.key]}
              onClick={() =>
                actions.updateQuestion(q.key, {
                  rel: { ...q.rel, [flag.key]: !q.rel[flag.key] },
                })
              }
              className={`h-7 w-7 rounded border text-xs ${
                q.rel[flag.key]
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input text-muted-foreground"
              }`}
            >
              {flag.short}
            </button>
          ))}
        </div>
      )}
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <select
          aria-label={`题目 ${q.code} 所属维度`}
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          value={q.dimensionKey}
          onChange={(e) =>
            actions.updateQuestion(
              q.key,
              { dimensionKey: e.target.value },
              false,
            )
          }
        >
          {usesTargets.map((target) => (
            <option key={target.key} value={target.key}>
              {target.parentKey === null ? target.name : `　${target.name}`}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={index === 0}
          onClick={() => actions.moveQuestion(q.key, -1)}
        >
          上移
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={index === total - 1}
          onClick={() => actions.moveQuestion(q.key, 1)}
        >
          下移
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => actions.duplicateQuestion(q.key)}
        >
          复制
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => actions.removeQuestions([q.key])}
        >
          删除
        </Button>
      </div>
    </div>
  );
}

/** 维度块：可选（拖拽排序）+ 题目列表（可排序、可跨维度拖放）+ 二级维度递归 */
export function SortableDimensionBlock({
  dim,
  depth,
  state,
  actions,
}: {
  dim: Dim;
  depth: 0 | 1;
  state: EditorState;
  actions: EditorActions;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dim.key, data: { type: "dimension" } });
  const { setNodeRef: setZoneRef, isOver } = useDroppable({
    id: `zone-${dim.key}`,
    data: { type: "dimension-zone", dimensionKey: dim.key },
  });

  const isOpen = actions.isExpanded(dim.key);
  const questions = questionsOf(state, dim.key);
  const children = childrenOf(state, dim.key);
  const siblings = state.dims.filter((d) => d.parentKey === dim.parentKey);
  const pos = siblings.findIndex((d) => d.key === dim.key);

  return (
    <div
      ref={setNodeRef}
      style={dragStyle(transform, transition, isDragging)}
      className={`rounded-md border ${depth === 1 ? "ml-4" : ""}`}
      data-testid={`dimension-${dim.name || dim.key}`}
    >
      <div className="bg-muted/30 flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <DragHandle
          label={`拖动维度 ${dim.name || dim.key}`}
          testId={`drag-dim-${dim.name || dim.key}`}
          attributes={attributes as unknown as Record<string, unknown>}
          listeners={
            listeners as unknown as Record<string, unknown> | undefined
          }
          isDragging={isDragging}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={isOpen}
          onClick={() => actions.toggleExpand(dim.key)}
        >
          {isOpen ? "收起" : "展开"}
        </Button>
        <Input
          aria-label="维度名称"
          className="h-8 w-40"
          value={dim.name}
          onChange={(e) => actions.updateDim(dim.key, { name: e.target.value })}
        />
        <div className="flex items-center gap-1">
          <Input
            aria-label="维度权重"
            className="h-8 w-20"
            inputMode="decimal"
            value={dim.weight}
            onChange={(e) =>
              actions.updateDim(dim.key, { weight: e.target.value })
            }
          />
          <span className="text-muted-foreground text-xs">
            %{depth === 0 ? "（一级维度权重合计需 100%）" : ""}
          </span>
        </div>
        <span className="text-muted-foreground text-xs">
          {questions.length} 题
          {children.length > 0 ? ` · ${children.length} 个二级维度` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pos <= 0}
            onClick={() => actions.moveDim(dim.key, -1)}
          >
            上移
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pos < 0 || pos >= siblings.length - 1}
            onClick={() => actions.moveDim(dim.key, 1)}
          >
            下移
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => actions.duplicateDim(dim.key)}
          >
            复制
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => actions.removeDim(dim.key)}
          >
            删除
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-3 px-3 py-3">
          <div className="space-y-1">
            <Label htmlFor={`dim-desc-${dim.key}`}>维度说明</Label>
            <Textarea
              id={`dim-desc-${dim.key}`}
              rows={2}
              value={dim.description}
              onChange={(e) =>
                actions.updateDim(dim.key, { description: e.target.value })
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">默认适用关系</span>
            {REL_FLAGS.map((flag) => (
              <label
                key={flag.key}
                className="flex items-center gap-1 text-sm"
                htmlFor={`dim-${dim.key}-${flag.key}`}
              >
                <input
                  id={`dim-${dim.key}-${flag.key}`}
                  type="checkbox"
                  className="size-4"
                  checked={dim.rel[flag.key]}
                  onChange={(e) =>
                    actions.updateDim(dim.key, {
                      rel: { ...dim.rel, [flag.key]: e.target.checked },
                    })
                  }
                />
                {flag.label}
              </label>
            ))}
          </div>

          {/* 题目拖放区域：可接收同维度排序与跨维度移动（含拖入空维度） */}
          <div
            ref={setZoneRef}
            className={`space-y-2 rounded ${isOver ? "ring-ring/40 ring-2" : ""}`}
            data-testid={`questions-${dim.name || dim.key}`}
          >
            <SortableContext
              items={questions.map((q) => q.key)}
              strategy={verticalListSortingStrategy}
            >
              {questions.map((q, index) => (
                <SortableQuestion
                  key={q.key}
                  question={q}
                  index={index}
                  total={questions.length}
                  actions={actions}
                  usesTargets={actions.questionTargets}
                />
              ))}
            </SortableContext>
            {questions.length === 0 && (
              <p className="text-muted-foreground rounded border border-dashed px-2 py-3 text-center text-xs">
                该维度下暂无题目，可把题目拖到此处
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => actions.addQuestion(dim.key)}
            >
              新增题目
            </Button>
            {depth === 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => actions.addChildDim(dim.key)}
              >
                新增二级维度
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={actions.selected.size === 0}
              onClick={() => actions.removeQuestions([...actions.selected])}
            >
              删除选中（{actions.selected.size}）
            </Button>
          </div>

          {children.length > 0 && (
            <SortableContext
              items={children.map((c) => c.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {children.map((child) => (
                  <SortableDimensionBlock
                    key={child.key}
                    dim={child}
                    depth={1}
                    state={state}
                    actions={actions}
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </div>
      )}
    </div>
  );
}

export { ALL_TRUE };
