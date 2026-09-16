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
import { Input } from "@/components/ui/input";
import type {
  QuestionnaireDTO,
  TemplateDTO,
} from "@/modules/questionnaires/service";

/**
 * 问卷模板库管理（PRD 第 13 节）：列表 + 展开预览 + 重命名 + 删除。
 * 权限由服务端决定（创建者或系统管理员），此处按 canManage 隐藏操作入口。
 */

type TemplateRow = TemplateDTO & { canManage: boolean };

const RELATION_LABELS: Array<{ key: string; label: string }> = [
  { key: "applicableSelf", label: "自评" },
  { key: "applicableManager", label: "上级" },
  { key: "applicablePeer", label: "平级" },
  { key: "applicableSubordinate", label: "下级" },
];

function applicabilityText(node: Record<string, unknown>): string {
  const on = RELATION_LABELS.filter((r) => node[r.key] === true).map(
    (r) => r.label,
  );
  return on.length === 0 ? "无" : on.join("/");
}

function DimensionPreview({
  dimension,
  depth,
}: {
  dimension: QuestionnaireDTO["dimensions"][number];
  depth: 0 | 1;
}) {
  return (
    <div className={depth === 1 ? "ml-4" : ""}>
      <p className="text-sm">
        <span className="font-medium">{dimension.name}</span>
        <span className="text-muted-foreground ml-2 text-xs">
          权重 {dimension.weight}% · 适用{" "}
          {applicabilityText(dimension as unknown as Record<string, unknown>)}
        </span>
      </p>
      {dimension.description && (
        <p className="text-muted-foreground text-xs">{dimension.description}</p>
      )}
      <ul className="mt-0.5 space-y-0.5">
        {dimension.questions.map((q) => (
          <li key={`${dimension.name}-${q.code}`} className="text-xs">
            <span className="text-muted-foreground mr-1 font-mono">
              {q.code}
            </span>
            {q.title}
            <span className="text-muted-foreground ml-1">
              （{q.type === "RATING" ? `量表 ${q.weight}%` : "开放题"}）
            </span>
          </li>
        ))}
      </ul>
      {dimension.children.map((child) => (
        <DimensionPreview
          key={`${dimension.name}-${child.name}`}
          dimension={child}
          depth={1}
        />
      ))}
    </div>
  );
}

export function TemplatesManager({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuestionnaireDTO | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  async function togglePreview(template: TemplateRow) {
    if (openId === template.id) {
      setOpenId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setOpenId(template.id);
    setDetail(null);
    setDetailError(null);
    try {
      const res = await fetch(`/api/questionnaire/templates/${template.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailError(data.error ?? "加载模板内容失败");
        return;
      }
      setDetail(data.questionnaire as QuestionnaireDTO);
    } catch {
      setDetailError("网络错误，请重试");
    }
  }

  async function saveName(template: TemplateRow) {
    setBusy(template.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/questionnaire/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateName: nameDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data.error ?? "重命名失败" });
        return;
      }
      setNotice({
        kind: "ok",
        text: `已重命名为「${data.template.templateName}」`,
      });
      setEditingId(null);
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "网络错误，请重试" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(template: TemplateRow) {
    if (
      !window.confirm(
        `确定删除模板「${template.templateName}」吗？\n已用该模板复制出的项目问卷不受影响。`,
      )
    ) {
      return;
    }
    setBusy(template.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/questionnaire/templates/${template.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice({ kind: "err", text: data.error ?? "删除失败" });
        return;
      }
      setNotice({ kind: "ok", text: `已删除模板「${template.templateName}」` });
      if (openId === template.id) {
        setOpenId(null);
        setDetail(null);
      }
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "网络错误，请重试" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>问卷模板（{templates.length}）</CardTitle>
        <CardDescription>
          在项目设置里「保存为模板」后，新项目可一键复制；复制出的问卷独立存在，不回写模板
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && (
          <p
            className={
              notice.kind === "ok"
                ? "rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-800"
                : "bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            }
            data-testid="template-notice"
          >
            {notice.text}
          </p>
        )}

        {templates.length === 0 ? (
          <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
            模板库还是空的。进入任一项目的「项目设置 →
            问卷」把已配置好的问卷保存为模板。
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className="rounded-md border"
                data-testid={`template-${template.templateName}`}
              >
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  {editingId === template.id ? (
                    <>
                      <Input
                        aria-label="模板名称"
                        className="h-8 w-56"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void saveName(template)}
                      >
                        保存
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">
                        {template.templateName}
                      </span>
                      <Badge variant="secondary">
                        {template.dimensionCount} 维度 ·{" "}
                        {template.questionCount} 题
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {new Date(template.createdAt).toLocaleString("zh-CN")}
                        {template.createdById === null && " · 历史模板"}
                      </span>
                      <div className="ml-auto flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void togglePreview(template)}
                        >
                          {openId === template.id ? "收起内容" : "查看内容"}
                        </Button>
                        {template.canManage ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(template.id);
                                setNameDraft(template.templateName);
                              }}
                            >
                              重命名
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void remove(template)}
                            >
                              删除
                            </Button>
                          </>
                        ) : (
                          <span className="text-muted-foreground self-center text-xs">
                            仅创建者或系统管理员可修改
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {openId === template.id && (
                  <div className="bg-muted/20 space-y-2 border-t px-3 py-3">
                    {detailError && (
                      <p className="text-destructive text-sm">{detailError}</p>
                    )}
                    {!detail && !detailError && (
                      <p className="text-muted-foreground text-sm">加载中…</p>
                    )}
                    {detail &&
                      (detail.dimensions.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          该模板没有维度
                        </p>
                      ) : (
                        detail.dimensions.map((dimension) => (
                          <DimensionPreview
                            key={dimension.name}
                            dimension={dimension}
                            depth={0}
                          />
                        ))
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
