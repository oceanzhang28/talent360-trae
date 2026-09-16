"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ProjectScaleDTO } from "@/modules/projects/service";

/** 评分档位（PRD 第 10 节）：分值固定 10 档，只能修改文字说明 */
export function ScalesEditor({
  projectId,
  scales,
  editable,
}: {
  projectId: string;
  scales: ProjectScaleDTO[];
  editable: boolean;
}) {
  const router = useRouter();
  const [labels, setLabels] = useState(() =>
    Object.fromEntries(scales.map((s) => [s.id, s.label])),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/scales`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: scales.map((s) => ({
            id: s.id,
            label: labels[s.id] ?? s.label,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "保存失败");
        return;
      }
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>评分档位（{scales.length}）</CardTitle>
        <CardDescription>
          分值固定为 0.5~5.0 共 10 档，只能修改每档的文字说明
          {!editable && "；当前状态不可修改"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2">
            {scales.map((s) => (
              <div key={s.id} className="contents">
                <div className="flex items-center justify-end font-mono text-sm font-medium">
                  {s.value.toFixed(1)}
                </div>
                <Input
                  value={labels[s.id] ?? ""}
                  onChange={(e) =>
                    setLabels((prev) => ({ ...prev, [s.id]: e.target.value }))
                  }
                  disabled={!editable}
                  maxLength={50}
                />
              </div>
            ))}
          </div>
          {error && (
            <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          )}
          {editable && (
            <div className="flex justify-end">
              <Button type="submit" disabled={loading}>
                {loading ? "保存中…" : "保存档位说明"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
