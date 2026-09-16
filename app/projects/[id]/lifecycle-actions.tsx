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
import type { ProjectDTO } from "@/modules/projects/service";
import { STATUS_LABEL, formatDateTime } from "@/modules/projects/status";

/** 生命周期操作（PRD 6.2/6.3）：按状态显示可用操作，权限校验在服务端 */
export function LifecycleActions({
  project,
  isSystemAdmin,
}: {
  project: ProjectDTO;
  isSystemAdmin: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "操作失败");
        return;
      }
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `确定删除项目「${project.name}」吗？删除后进入回收站，30 天后物理清除。`,
      )
    ) {
      return;
    }
    setLoading("delete");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "删除失败");
        return;
      }
      router.replace("/projects");
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>生命周期</CardTitle>
        <CardDescription>
          当前状态：{STATUS_LABEL[project.status]}
          {project.endAt && ` · 截止：${formatDateTime(project.endAt)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {project.status === "DRAFT" && (
          <Button onClick={() => run("publish")} disabled={loading !== null}>
            {loading === "publish" ? "发布中…" : "发布项目"}
          </Button>
        )}
        {project.status === "ACTIVE" && (
          <Button
            variant="outline"
            onClick={() =>
              run("close", "确定提前结束吗？结束後员工将不能继续提交评价。")
            }
            disabled={loading !== null}
          >
            {loading === "close" ? "处理中…" : "提前结束"}
          </Button>
        )}
        {project.status === "CLOSED" && (
          <Button onClick={() => run("freeze")} disabled={loading !== null}>
            {loading === "freeze" ? "冻结中…" : "冻结结果"}
          </Button>
        )}
        {project.status === "FROZEN" && (
          <>
            <Button
              variant="outline"
              onClick={() =>
                run("archive", "确定归档吗？归档后项目成为历史记录。")
              }
              disabled={loading !== null}
            >
              {loading === "archive" ? "归档中…" : "归档项目"}
            </Button>
            {isSystemAdmin && (
              <Button
                variant="outline"
                onClick={() =>
                  run("unfreeze", "确定解冻吗？解冻后项目回到已截止状态。")
                }
                disabled={loading !== null}
              >
                {loading === "unfreeze" ? "解冻中…" : "解冻（仅系统管理员）"}
              </Button>
            )}
          </>
        )}
        {isSystemAdmin && project.status !== "ARCHIVED" && (
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading !== null}
          >
            {loading === "delete" ? "删除中…" : "删除项目"}
          </Button>
        )}
        {project.status === "ARCHIVED" && (
          <p className="text-muted-foreground text-sm">
            已归档项目为历史记录，无可用操作
          </p>
        )}
        {error && <p className="text-destructive w-full text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
