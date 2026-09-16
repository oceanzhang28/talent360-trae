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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectAdminDTO } from "@/modules/projects/service";
import { formatDateTime } from "@/modules/projects/status";

/** 项目管理员（HR）配置：按工号添加，用户需已登录过系统 */
export function AdminsManager({
  projectId,
  admins,
}: {
  projectId: string;
  admins: ProjectAdminDTO[];
}) {
  const router = useRouter();
  const [employeeNo, setEmployeeNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading("add");
    try {
      const res = await fetch(`/api/projects/${projectId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeNo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "添加失败");
        return;
      }
      setEmployeeNo("");
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(null);
    }
  }

  async function handleRemove(adminId: string, name: string) {
    if (!window.confirm(`确定移除管理员「${name}」吗？`)) return;
    setError(null);
    setLoading(adminId);
    try {
      const res = await fetch(`/api/projects/${projectId}/admins/${adminId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "移除失败");
        return;
      }
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
        <CardTitle>项目管理员（{admins.length}）</CardTitle>
        <CardDescription>
          管理员可配置问卷、人员、查看进度与结果；按工号添加（用户需登录过一次）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>工号</TableHead>
              <TableHead>姓名</TableHead>
              <TableHead>添加时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  {a.employeeNo ?? "-"}
                </TableCell>
                <TableCell>{a.name}</TableCell>
                <TableCell>{formatDateTime(a.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemove(a.id, a.name)}
                    disabled={loading !== null}
                  >
                    {loading === a.id ? "移除中…" : "移除"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form onSubmit={handleAdd} className="flex items-end gap-2">
          <div className="w-48 space-y-2">
            <label htmlFor="admin-employeeNo" className="text-sm font-medium">
              工号
            </label>
            <Input
              id="admin-employeeNo"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              placeholder="例如 10001"
              required
            />
          </div>
          <Button type="submit" disabled={loading !== null}>
            {loading === "add" ? "添加中…" : "添加管理员"}
          </Button>
        </form>
        {error && (
          <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
