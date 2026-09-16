"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { QuestionnaireDTO } from "@/modules/questionnaires/service";
import {
  validateQuestionnaire,
  type ValidationError,
} from "@/modules/questionnaires/validate";
import {
  ALL_TRUE,
  childrenOf,
  moveQuestionByDrag,
  nextKey,
  nextQuestionCode,
  questionsOf,
  reorderDimensions,
  toEditorState,
  toPayload,
  uniqueCode,
  type Dim,
  type EditorState,
  type Q,
  type QuestionDropTarget,
} from "./editor-model";
import { SortableDimensionBlock, type EditorActions } from "./editor-parts";

/**
 * 在线问卷编辑器（PRD 第 12.1 节 + 第 11.1 节维度级适用关系）。
 *
 * - 编辑即为「整树保存」：本地维护维度/题目数组，变更后防抖 PUT 整棵树
 * - 允许保存校验未通过的中间状态（先搭结构再配权重），完整性由发布前校验兜底
 * - 校验规则直接复用服务端同一份纯函数（modules/questionnaires/validate.ts），提示口径一致
 * - 拖拽排序用 dnd-kit：维度同级排序、题目同维度排序 + 跨维度移动（拖到目标维度区域）
 * - 撤销/重做基于本地历史快照；同一字段连续输入会合并为一步，避免逐字符撤销
 */

type SaveStatus = {
  /** 已保存到的变更版本；与当前 rev 不同即为有未保存改动 */
  savedRev: number;
  savedAt: number | null;
  saving: boolean;
  error: string | null;
};

export function QuestionnaireEditor({
  projectId,
  initial,
}: {
  projectId: string;
  initial: QuestionnaireDTO | null;
}) {
  const [state, setState] = useState<EditorState>(() => toEditorState(initial));
  // 注意：key 由 toEditorState 生成，必须复用同一份 state（不能再次调用 toEditorState，否则 key 不匹配）
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(state.dims.filter((d) => d.parentKey === null).map((d) => d.key)),
  );
  const [past, setPast] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({
    savedRev: 0,
    savedAt: null,
    saving: false,
    error: null,
  });
  const [rev, setRev] = useState(0);

  const lastAction = useRef<{ key: string; at: number } | null>(null);

  /** 提交一次变更：结构类操作立即入历史，同一字段连续输入合并为一步 */
  const commit = useCallback(
    (next: EditorState, actionKey: string) => {
      const now = Date.now();
      const last = lastAction.current;
      const merge =
        last !== null && last.key === actionKey && now - last.at < 800;
      if (!merge) {
        setPast((prev) => [...prev.slice(-49), state]);
        setFuture([]);
      }
      lastAction.current = { key: actionKey, at: now };
      setState(next);
      setRev((v) => v + 1);
    },
    [state],
  );

  const undo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const target = prevPast[prevPast.length - 1]!;
      setFuture((prevFuture) => [state, ...prevFuture].slice(0, 50));
      setState(target);
      setRev((v) => v + 1);
      lastAction.current = null;
      return prevPast.slice(0, -1);
    });
  }, [state]);

  const redo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const target = prevFuture[0]!;
      setPast((prevPast) => [...prevPast.slice(-49), state]);
      setState(target);
      setRev((v) => v + 1);
      lastAction.current = null;
      return prevFuture.slice(1);
    });
  }, [state]);

  const payload = useMemo(() => toPayload(state), [state]);

  /** 客户端实时校验：与服务端发布前校验同一套规则 */
  const validationErrors: ValidationError[] = useMemo(() => {
    try {
      return validateQuestionnaire(payload);
    } catch {
      return [];
    }
  }, [payload]);

  /** 必填项缺失时不允许保存（避免服务端 400 打断编辑），给出明确原因 */
  const blockingReason = useMemo(() => {
    if (state.dims.some((d) => d.name.trim() === "")) return "存在未命名的维度";
    if (
      state.dims.some(
        (d) =>
          d.parentKey !== null &&
          !state.dims.some((p) => p.key === d.parentKey),
      )
    ) {
      return "存在找不到上级的二级维度";
    }
    if (state.questions.some((q) => q.code.trim() === ""))
      return "存在未填写编号的题目";
    if (state.questions.some((q) => q.title.trim() === ""))
      return "存在未填写题干的题目";
    return null;
  }, [state]);

  // 自动保存：变更后 1.2s 落库（与评价端草稿自动保存同一节奏）
  // 注意：不在 effect 内同步 setState（避免级联渲染），保存态在异步回调里更新
  useEffect(() => {
    if (rev === saveStatus.savedRev || blockingReason) return;
    const timer = setTimeout(() => {
      void (async () => {
        setSaveStatus((prev) => ({ ...prev, saving: true, error: null }));
        try {
          const res = await fetch(`/api/projects/${projectId}/questionnaire`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            setSaveStatus((prev) => ({
              ...prev,
              saving: false,
              error: data.error ?? "保存失败，请重试",
            }));
            return;
          }
          setSaveStatus({
            savedRev: rev,
            savedAt: Date.now(),
            saving: false,
            error: null,
          });
        } catch {
          setSaveStatus((prev) => ({
            ...prev,
            saving: false,
            error: "网络错误，请重试",
          }));
        }
      })();
    }, 1200);
    return () => clearTimeout(timer);
  }, [rev, payload, blockingReason, projectId, saveStatus.savedRev]);

  // 快捷键：焦点不在输入框时生效，避免抢占输入框内的原生撤销
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const usedCodes = useMemo(
    () => new Set(state.questions.map((q) => q.code.trim())),
    [state.questions],
  );

  // ---------- 变更操作 ----------

  function addTopDimension() {
    const dim: Dim = {
      key: nextKey("d"),
      parentKey: null,
      name: `新维度${state.dims.filter((d) => d.parentKey === null).length + 1}`,
      description: "",
      weight: "0",
      rel: { ...ALL_TRUE },
    };
    setExpanded((prev) => new Set(prev).add(dim.key));
    commit({ ...state, dims: [...state.dims, dim] }, `add-dim-${dim.key}`);
  }

  function addChildDimension(parentKey: string) {
    const dim: Dim = {
      key: nextKey("d"),
      parentKey,
      name: "新二级维度",
      description: "",
      weight: "0",
      rel: { ...ALL_TRUE },
    };
    setExpanded((prev) => new Set(prev).add(dim.key));
    commit({ ...state, dims: [...state.dims, dim] }, `add-dim-${dim.key}`);
  }

  function updateDimension(key: string, patch: Partial<Dim>) {
    commit(
      {
        ...state,
        dims: state.dims.map((d) => (d.key === key ? { ...d, ...patch } : d)),
      },
      `dim-${key}-${Object.keys(patch).join(",")}`,
    );
  }

  function duplicateDimension(key: string) {
    const source = state.dims.find((d) => d.key === key);
    if (!source) return;
    const copyKey = nextKey("d");
    const copy: Dim = { ...source, key: copyKey, name: `${source.name} 副本` };
    const used = new Set(state.questions.map((q) => q.code));
    const copiedQuestions = state.questions
      .filter((q) => q.dimensionKey === key)
      .map((q) => {
        const code = uniqueCode(q.code, used);
        used.add(code);
        return { ...q, key: nextKey("q"), dimensionKey: copyKey, code };
      });
    const index = state.dims.findIndex((d) => d.key === key);
    const dims = [...state.dims];
    dims.splice(index + 1, 0, copy);
    // 二级维度副本紧随其后；其子维度不复制（维度树仅两级）
    commit(
      { ...state, dims, questions: [...state.questions, ...copiedQuestions] },
      nextKey("dup-dim"),
    );
  }

  function removeDimension(key: string) {
    const doomed = [key, ...childrenOf(state, key).map((c) => c.key)];
    commit(
      {
        dims: state.dims.filter((d) => !doomed.includes(d.key)),
        questions: state.questions.filter(
          (q) => !doomed.includes(q.dimensionKey),
        ),
      },
      nextKey("del-dim"),
    );
  }

  function moveDimension(key: string, delta: -1 | 1) {
    const dim = state.dims.find((d) => d.key === key);
    if (!dim) return;
    const siblings = state.dims.filter((d) => d.parentKey === dim.parentKey);
    const pos = siblings.findIndex((d) => d.key === key);
    const target = siblings[pos + delta];
    if (!target) return;
    commit(
      reorderDimensions(state, key, target.key) ?? state,
      nextKey("move-dim"),
    );
  }

  function addQuestion(dimensionKey: string) {
    const q: Q = {
      key: nextKey("q"),
      dimensionKey,
      code: nextQuestionCode(usedCodes),
      type: "RATING",
      title: "",
      description: "",
      weight: "100",
      required: true,
      override: false,
      rel: { ...ALL_TRUE },
    };
    commit({ ...state, questions: [...state.questions, q] }, `add-q-${q.key}`);
  }

  function updateQuestion(key: string, patch: Partial<Q>, merge = true) {
    commit(
      {
        ...state,
        questions: state.questions.map((q) =>
          q.key === key ? { ...q, ...patch } : q,
        ),
      },
      merge ? `q-${key}-${Object.keys(patch).join(",")}` : nextKey("q"),
    );
  }

  function duplicateQuestion(key: string) {
    const source = state.questions.find((q) => q.key === key);
    if (!source) return;
    const copy: Q = {
      ...source,
      key: nextKey("q"),
      code: uniqueCode(source.code, usedCodes),
    };
    const index = state.questions.findIndex((q) => q.key === key);
    const questions = [...state.questions];
    questions.splice(index + 1, 0, copy);
    commit({ ...state, questions }, nextKey("dup-q"));
  }

  function removeQuestions(keys: string[]) {
    commit(
      {
        ...state,
        questions: state.questions.filter((q) => !keys.includes(q.key)),
      },
      nextKey("del-q"),
    );
    setSelected(new Set());
  }

  function moveQuestion(key: string, delta: -1 | 1) {
    const q = state.questions.find((item) => item.key === key);
    if (!q) return;
    const siblings = questionsOf(state, q.dimensionKey);
    const pos = siblings.findIndex((item) => item.key === key);
    const target = siblings[pos + delta];
    if (!target) return;
    const questions = [...state.questions];
    const from = questions.findIndex((item) => item.key === key);
    const to = questions.findIndex((item) => item.key === target.key);
    questions.splice(from, 1);
    questions.splice(to, 0, q);
    commit({ ...state, questions }, nextKey("move-q"));
  }

  // ---------- 拖拽 ----------

  const sensors = useSensors(
    // 鼠标需移动 4px 才激活，避免与输入框点击冲突；触屏长按 200ms 激活，保留页面滚动
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeType = (active.data.current as { type?: string } | undefined)
      ?.type;
    const overData = over.data.current as
      { type?: string; dimensionKey?: string } | undefined;

    if (activeType === "dimension") {
      const next = reorderDimensions(state, String(active.id), String(over.id));
      if (next) commit(next, nextKey("drag-dim"));
      return;
    }

    if (activeType !== "question") return;

    let target: QuestionDropTarget | null = null;
    if (overData?.type === "question") {
      target = { type: "question", key: String(over.id) };
    } else if (overData?.type === "dimension-zone") {
      target = { type: "zone", dimensionKey: overData.dimensionKey! };
    } else if (overData?.type === "dimension") {
      // 直接拖到维度块上：追加到该维度末尾
      target = { type: "zone", dimensionKey: String(over.id) };
    }
    if (!target) return;

    const next = moveQuestionByDrag(state, String(active.id), target);
    if (next) commit(next, nextKey("drag-q"));
  }

  // ---------- 渲染 ----------

  const actions: EditorActions = {
    toggleExpand: (key) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    isExpanded: (key) => expanded.has(key),
    updateDim: updateDimension,
    removeDim: removeDimension,
    duplicateDim: duplicateDimension,
    moveDim: moveDimension,
    addQuestion,
    addChildDim: addChildDimension,
    updateQuestion,
    duplicateQuestion,
    removeQuestions,
    moveQuestion,
    selected,
    toggleSelect: (key) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    questionTargets: state.dims.filter(
      (d) => d.parentKey !== null || childrenOf(state, d.key).length === 0,
    ),
  };

  const dirty = rev !== saveStatus.savedRev;
  const saveLabel = saveStatus.error
    ? `保存失败：${saveStatus.error}`
    : blockingReason
      ? `未保存：${blockingReason}（补全后会自动保存）`
      : saveStatus.saving
        ? "保存中…"
        : dirty
          ? "有未保存的改动…"
          : saveStatus.savedAt
            ? `已自动保存 ${new Date(saveStatus.savedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
            : "已载入服务器数据";
  const saveTone =
    saveStatus.error || blockingReason
      ? "text-destructive"
      : "text-muted-foreground";

  const topDims = state.dims.filter((d) => d.parentKey === null);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>在线编辑问卷</CardTitle>
            <CardDescription>
              改动自动保存；拖动 ⠿ 可调整维度与题目顺序，题目可拖到其他维度
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs ${saveTone}`} data-testid="save-status">
              {saveLabel}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={past.length === 0}
              onClick={undo}
            >
              撤销
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={future.length === 0}
              onClick={redo}
            >
              重做
            </Button>
            <Button type="button" size="sm" onClick={addTopDimension}>
              新增一级维度
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {validationErrors.length > 0 ? (
          <div
            className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            data-testid="validation-errors"
          >
            <p className="font-medium">
              问卷尚未通过完整性校验（可继续编辑，但无法发布）：
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {validationErrors.slice(0, 8).map((err, index) => (
                <li key={`${err.path}-${index}`}>
                  {err.path}：{err.message}
                </li>
              ))}
            </ul>
            {validationErrors.length > 8 && (
              <p className="text-xs">其余 {validationErrors.length - 8} 项略</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-emerald-700" data-testid="validation-ok">
            问卷完整性校验通过，可发布。
          </p>
        )}

        {topDims.length === 0 ? (
          <div className="rounded-md border p-6 text-center">
            <p className="font-medium">问卷还是空的</p>
            <p className="text-muted-foreground mt-1 text-sm">
              点击「新增一级维度」开始在线搭建，或回到项目设置用 Excel 导入
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={topDims.map((d) => d.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {topDims.map((dim) => (
                  <SortableDimensionBlock
                    key={dim.key}
                    dim={dim}
                    depth={0}
                    state={state}
                    actions={actions}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Badge variant="secondary">
            一级维度 {topDims.length} · 维度合计 {state.dims.length} · 题目{" "}
            {state.questions.length}
          </Badge>
          <span className="text-muted-foreground text-xs">
            快捷键：撤销 ⌘/Ctrl+Z · 重做
            ⇧⌘/Ctrl+Z（焦点在输入框内时使用系统原生撤销）
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
