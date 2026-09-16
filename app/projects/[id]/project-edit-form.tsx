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
import type { ProjectDTO } from "@/modules/projects/service";
import { toLocalInputValue } from "@/modules/projects/status";

/**
 * 基本信息编辑（按状态限制，PRD 6.3）：
 * - DRAFT/PUBLISHED：全部字段
 * - ACTIVE：仅截止时间（只能延长）
 * - CLOSED：仅截止时间（设为未来时间即重新开放）
 * - FROZEN/ARCHIVED：只读
 */
export function ProjectEditForm({ project }: { project: ProjectDTO }) {
  const router = useRouter();
  const editable = project.status === "DRAFT" || project.status === "PUBLISHED";
  const timeOnly = project.status === "ACTIVE" || project.status === "CLOSED";
  const readOnly = !editable && !timeOnly;

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [instruction, setInstruction] = useState(
    project.questionnaireInstruction ?? "",
  );
  const [startAt, setStartAt] = useState(toLocalInputValue(project.startAt));
  const [endAt, setEndAt] = useState(toLocalInputValue(project.endAt));
  const [managerWeight, setManagerWeight] = useState(
    String(project.managerWeight),
  );
  const [peerWeight, setPeerWeight] = useState(String(project.peerWeight));
  const [subordinateWeight, setSubordinateWeight] = useState(
    String(project.subordinateWeight),
  );
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
      const body = timeOnly
        ? { endAt: endAt ? new Date(endAt).toISOString() : null }
        : {
            name,
            description: description || null,
            questionnaireInstruction: instruction || null,
            startAt: startAt ? new Date(startAt).toISOString() : null,
            endAt: endAt ? new Date(endAt).toISOString() : null,
            managerWeight: Number(managerWeight),
            peerWeight: Number(peerWeight),
            subordinateWeight: Number(subordinateWeight),
          };
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        <CardTitle>基本信息</CardTitle>
        <CardDescription>
          {readOnly
            ? "当前状态只读"
            : timeOnly
              ? project.status === "ACTIVE"
                ? "测评中：只能延长截止时间"
                : "已截止：设置未来时间将重新开放项目"
              : "草稿/已发布状态可编辑全部配置"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">项目名称</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly || timeOnly}
              required
              maxLength={100}
            />
          </div>
          {!timeOnly && !readOnly && (
            <>
              <div className="space-y-2">
                <Label htmlFor="description">项目描述</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instruction">问卷说明（员工填写时展示）</Label>
                <Textarea
                  id="instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={3}
                  placeholder="例如：请根据被评人过去一年的实际表现进行评价……"
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
                  合计：{weightSum}%
                  {weightSum !== 100 && "（发布前必须等于 100%）"}
                </p>
              </div>
            </>
          )}
          {timeOnly && (
            <div className="space-y-2">
              <Label htmlFor="endAt-only">截止时间</Label>
              <Input
                id="endAt-only"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                required
              />
            </div>
          )}
          {error && (
            <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          )}
          {!readOnly && (
            <div className="flex justify-end">
              <Button type="submit" disabled={loading}>
                {loading ? "保存中…" : "保存修改"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
