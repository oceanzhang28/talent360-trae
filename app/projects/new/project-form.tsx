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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** 新建项目表单：创建后自动成为项目管理员，并播种默认 10 档评分档位 */
export function ProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [managerWeight, setManagerWeight] = useState("40");
  const [peerWeight, setPeerWeight] = useState("30");
  const [subordinateWeight, setSubordinateWeight] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const weightSum =
    (Number(managerWeight) || 0) +
    (Number(peerWeight) || 0) +
    (Number(subordinateWeight) || 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          startAt: startAt ? new Date(startAt).toISOString() : undefined,
          endAt: endAt ? new Date(endAt).toISOString() : undefined,
          managerWeight: Number(managerWeight),
          peerWeight: Number(peerWeight),
          subordinateWeight: Number(subordinateWeight),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "创建失败，请重试");
        return;
      }
      router.replace(`/projects/${data.project.id}`);
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
        <CardTitle>基本信息</CardTitle>
        <CardDescription>
          创建后进入草稿状态；发布前需设置起止时间，且关系权重合计为 100%
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">项目名称 *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 2026 年度人才盘点"
              required
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">项目描述</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目背景、目的等（选填）"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startAt">开始时间</Label>
              <Input
                id="startAt"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endAt">截止时间</Label>
              <Input
                id="endAt"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>关系权重（%）</Label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label
                  htmlFor="managerWeight"
                  className="text-muted-foreground text-xs"
                >
                  上级
                </Label>
                <Input
                  id="managerWeight"
                  type="number"
                  min={0}
                  max={100}
                  value={managerWeight}
                  onChange={(e) => setManagerWeight(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="peerWeight"
                  className="text-muted-foreground text-xs"
                >
                  平级
                </Label>
                <Input
                  id="peerWeight"
                  type="number"
                  min={0}
                  max={100}
                  value={peerWeight}
                  onChange={(e) => setPeerWeight(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="subordinateWeight"
                  className="text-muted-foreground text-xs"
                >
                  下级
                </Label>
                <Input
                  id="subordinateWeight"
                  type="number"
                  min={0}
                  max={100}
                  value={subordinateWeight}
                  onChange={(e) => setSubordinateWeight(e.target.value)}
                />
              </div>
            </div>
            <p
              className={`text-xs ${weightSum === 100 ? "text-muted-foreground" : "text-destructive"}`}
            >
              合计：{weightSum}%{weightSum !== 100 && "（发布前必须等于 100%）"}
            </p>
          </div>
          {error && (
            <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/projects")}
            >
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "创建中…" : "创建项目"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
