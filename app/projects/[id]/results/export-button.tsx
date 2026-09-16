"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// 与 modules/results/excel.ts 的 RESULTS_EXCEL_FILENAME 保持一致（不直接导入，避免把 ExcelJS 打进 client bundle）
const RESULTS_EXCEL_FILENAME = "360_results.xlsx";

/** 导出完整结果 Excel（POST → blob 下载；技术文档第 54 节 6 个 Sheet） */
export function ExportButton({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/export/excel`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `导出失败（${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = RESULTS_EXCEL_FILENAME;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("导出失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-destructive text-sm">{error}</span> : null}
      <Button onClick={handleExport} disabled={loading} size="sm">
        {loading ? "导出中…" : "导出 Excel"}
      </Button>
    </div>
  );
}
