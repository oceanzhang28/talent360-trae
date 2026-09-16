"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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

type ImportErrorDetails = {
  parseErrors?: { row: number; message: string }[];
  validationErrors?: { path: string; message: string }[];
};

/** 项目问卷卡片：Excel 导入 / 模板操作（PRD 第 12、13 节） */
export function QuestionnaireCard({
  projectId,
  questionnaire,
  editable,
}: {
  projectId: string;
  questionnaire: QuestionnaireDTO | null;
  editable: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<ImportErrorDetails | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<TemplateDTO[] | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  async function run(action: () => Promise<void>) {
    setError(null);
    setErrorDetails(null);
    setMessage(null);
    setLoading(true);
    try {
      await action();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  /** 响应非 2xx 时读取 error + details 并返回 true */
  function readApiError(
    status: number,
    data: Record<string, unknown>,
  ): boolean {
    if (status < 300) return false;
    setError(typeof data.error === "string" ? data.error : "操作失败");
    if (data.details && typeof data.details === "object") {
      setErrorDetails(data.details as ImportErrorDetails);
    }
    return true;
  }

  function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("请先选择 .xlsx 文件");
      return;
    }
    void run(async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/projects/${projectId}/questionnaire/import`,
        {
          method: "POST",
          body: form,
        },
      );
      const data = await res.json().catch(() => ({}));
      if (readApiError(res.status, data)) return;
      setMessage(
        `导入成功（${data.questionnaire.dimensionCount} 个维度、${data.questionnaire.questionCount} 道题）`,
      );
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function handleSaveAsTemplate() {
    void run(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/questionnaire/save-as-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateName }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (readApiError(res.status, data)) return;
      setMessage(`已保存为模板「${data.template.templateName}」`);
      setTemplateName("");
      setTemplates(null); // 下次重新加载列表
    });
  }

  function loadTemplates() {
    void run(async () => {
      const res = await fetch("/api/questionnaire/templates");
      const data = await res.json().catch(() => ({}));
      if (readApiError(res.status, data)) return;
      setTemplates(data.templates ?? []);
      if ((data.templates ?? []).length > 0) {
        setSelectedTemplate(data.templates[0].id);
      }
    });
  }

  function handleApplyTemplate() {
    if (!selectedTemplate) return;
    void run(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/questionnaire/apply-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: selectedTemplate }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (readApiError(res.status, data)) return;
      setMessage(
        `已从模板导入（${data.questionnaire.dimensionCount} 个维度、${data.questionnaire.questionCount} 道题）`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          问卷
          {questionnaire ? (
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {questionnaire.dimensionCount} 个维度 ·{" "}
              {questionnaire.questionCount} 道题
              {questionnaire.lockedAt && " · 已锁定"}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          通过 Excel 导入维度与题目（PRD 12.2 的 16
          个标准字段）；重复导入会整体替换现有问卷
          {!editable && "；当前状态不可修改"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!questionnaire && (
          <p className="text-muted-foreground text-sm">
            尚未导入问卷。发布项目前必须先导入（至少一个维度和一道题目）。
          </p>
        )}
        {questionnaire && (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}/questionnaire`}>
                查看问卷预览
              </Link>
            </Button>
            {editable && (
              <Button asChild size="sm">
                <Link href={`/projects/${projectId}/questionnaire?view=edit`}>
                  在线编辑
                </Link>
              </Button>
            )}
          </>
        )}

        {editable && (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/projects/${projectId}/questionnaire/template`}
                  className="text-primary text-sm underline-offset-4 hover:underline"
                >
                  下载 Excel 模板
                </a>
                <span className="text-muted-foreground text-xs">
                  含示例数据与填写说明
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="text-sm"
                  aria-label="问卷 Excel 文件"
                />
                <Button size="sm" onClick={handleImport} disabled={loading}>
                  {loading ? "导入中…" : "导入 Excel"}
                </Button>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-medium">模板</p>
              {questionnaire && (
                <div className="mb-2 flex items-center gap-2">
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="保存为模板的名称"
                    maxLength={100}
                    className="max-w-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveAsTemplate}
                    disabled={loading || !templateName.trim()}
                  >
                    保存为模板
                  </Button>
                </div>
              )}
              {templates === null ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadTemplates}
                  disabled={loading}
                >
                  从模板导入…
                </Button>
              ) : templates.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  还没有可用的问卷模板
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="border-input bg-background h-9 max-w-xs rounded-md border px-3 text-sm"
                    aria-label="选择问卷模板"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.templateName}（{t.dimensionCount} 维度 /{" "}
                        {t.questionCount} 题）
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleApplyTemplate}
                    disabled={loading || !selectedTemplate}
                  >
                    应用模板
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive space-y-2 rounded-md px-3 py-2 text-sm">
            <p>{error}</p>
            {errorDetails?.parseErrors &&
              errorDetails.parseErrors.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {errorDetails.parseErrors.map((e, i) => (
                    <li key={i}>
                      第 {e.row} 行：{e.message}
                    </li>
                  ))}
                </ul>
              )}
            {errorDetails?.validationErrors &&
              errorDetails.validationErrors.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {errorDetails.validationErrors.map((e, i) => (
                    <li key={i}>
                      {e.path}：{e.message}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
        {message && (
          <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
