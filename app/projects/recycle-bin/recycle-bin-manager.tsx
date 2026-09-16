"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  formatDateTime,
} from "@/modules/projects/status";
import type { DeletedProjectDTO } from "@/modules/projects/service";

/**
 * 回收站（PRD 第 44 节）：列出已软删除项目，30 天内可恢复，过期后可彻底清理。
 * 权限由服务端判定（仅系统管理员），此处只负责交互。
 */
export function RecycleBinManager({
  projects,
}: {
  projects: DeletedProjectDTO[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const purgeableCount = projects.filter((p) => p.purgeable).length;

  async function run(
    key: string,
    url: string,
    init: RequestInit,
    okText: string,
  ) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice({ kind: "err", text: data.error ?? "操作失败" });
        return;
      }
      setNotice({ kind: "ok", text: okText });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "网络错误，请重试" });
    } finally {
      setBusy(null);
    }
  }

  function handleRestore(project: DeletedProjectDTO) {
    if (
      !window.confirm(
        `确定恢复项目「${project.name}」吗？\n将还原为删除前的状态（${STATUS_LABEL[project.statusBeforeDelete ?? "DRAFT"]}），全部问卷、人员与评价数据保留。`,
      )
    ) {
      return;
    }
    void run(
      project.id,
      `/api/projects/${project.id}/restore`,
      { method: "POST" },
      `已恢复项目「${project.name}」`,
    );
  }

  function handlePurge(project: DeletedProjectDTO) {
    if (
      !window.confirm(
        `确定彻底清理项目「${project.name}」吗？\n该项目及其问卷、人员、评价关系、结果快照将被永久删除，无法恢复。`,
      )
    ) {
      return;
    }
    void run(
      project.id,
      `/api/projects/${project.id}/purge`,
      { method: "DELETE" },
      `已彻底清理项目「${project.name}」`,
    );
  }

  function handlePurgeExpired() {
    if (
      !window.confirm(
        `确定清理全部 ${purgeableCount} 个已过保留期的项目吗？此操作不可恢复。`,
      )
    ) {
      return;
    }
    void run(
      "purge-expired",
      "/api/projects/recycle-bin/purge-expired",
      { method: "POST" },
      "已清理过保留期的项目",
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>回收站（{projects.length}）</CardTitle>
            <CardDescription>
              删除后保留 30 天，期间可随时恢复；超过 30 天可彻底清理（不可恢复）
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || purgeableCount === 0}
            onClick={handlePurgeExpired}
            data-testid="purge-expired"
          >
            清理已过期（{purgeableCount}）
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && (
          <p
            className={
              notice.kind === "ok"
                ? "rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-800"
                : "bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            }
            data-testid="recycle-notice"
          >
            {notice.text}
          </p>
        )}

        {projects.length === 0 ? (
          <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
            回收站是空的。系统管理员删除项目后会出现在这里。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目名称</TableHead>
                <TableHead>删除前状态</TableHead>
                <TableHead>删除时间</TableHead>
                <TableHead>保留剩余</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow
                  key={project.id}
                  data-testid={`deleted-${project.name}`}
                >
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        STATUS_BADGE[project.statusBeforeDelete ?? "DRAFT"]
                      }
                    >
                      {STATUS_LABEL[project.statusBeforeDelete ?? "DRAFT"]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(project.deletedAt)}</TableCell>
                  <TableCell>
                    {project.purgeable ? (
                      <span className="text-destructive">已过保留期</span>
                    ) : (
                      <span>剩余 {project.daysLeft} 天</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => handleRestore(project)}
                      >
                        恢复
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || !project.purgeable}
                        title={
                          project.purgeable
                            ? undefined
                            : `保留期未满（剩余 ${project.daysLeft} 天）`
                        }
                        onClick={() => handlePurge(project)}
                      >
                        彻底清理
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
