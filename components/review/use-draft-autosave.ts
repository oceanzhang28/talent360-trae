"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 多任务草稿自动保存 hook（单人模式 / 矩阵模式共用，技术文档第 49 节）。
 * - debounce 1.5s，只提交变化字段（PUT /api/tasks/:id/draft 增量）
 * - pending 以 `${taskId}:${questionId}` 为键，seq 版本号保证「保存中又被修改」的条目不被误删
 * - flush 时按任务分组并行保存；矩阵切维度/切关系/切单人、单人切矩阵前先 flush 落库
 */

export type AnswerValue = { score: number | null; textValue: string | null };

export type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 1500;

type PendingEntry = {
  taskId: string;
  questionId: string;
  value: AnswerValue;
  seq: number;
};

export function useDraftAutosave() {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const pendingRef = useRef(new Map<string, PendingEntry>());
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return false;
    if (pendingRef.current.size === 0) return true;
    const snapshot = Array.from(pendingRef.current.entries());
    inFlightRef.current = true;
    setSaveState("saving");
    try {
      // 按任务分组：每个任务一次增量 PUT（单人模式只有一组）
      const byTask = new Map<string, PendingEntry[]>();
      for (const [, entry] of snapshot) {
        const list = byTask.get(entry.taskId) ?? [];
        list.push(entry);
        byTask.set(entry.taskId, list);
      }
      const responses = await Promise.all(
        Array.from(byTask.entries()).map(async ([taskId, entries]) => {
          const res = await fetch(`/api/tasks/${taskId}/draft`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              answers: entries.map((e) => ({
                questionId: e.questionId,
                score: e.value.score,
                textValue: e.value.textValue,
              })),
            }),
          });
          return { ok: res.ok, entries };
        }),
      );
      if (responses.some((r) => !r.ok)) {
        setSaveState("error");
        return false;
      }
      // 只清除保存期间未被再次修改的条目
      for (const { entries } of responses) {
        for (const e of entries) {
          const current = pendingRef.current.get(`${e.taskId}:${e.questionId}`);
          if (current && current.seq === e.seq) {
            pendingRef.current.delete(`${e.taskId}:${e.questionId}`);
          }
        }
      }
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  const update = useCallback(
    (taskId: string, questionId: string, value: AnswerValue) => {
      seqRef.current += 1;
      pendingRef.current.set(`${taskId}:${questionId}`, {
        taskId,
        questionId,
        value,
        seq: seqRef.current,
      });
      setSaveState("idle");
      scheduleSave();
    },
    [scheduleSave],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // 卸载清理定时器；离开页面前有未保存草稿时提示（真实用户场景）
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { saveState, savedAt, update, flush, clearTimer };
}
