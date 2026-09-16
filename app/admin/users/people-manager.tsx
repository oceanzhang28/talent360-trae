"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PersonRow = {
  id: string;
  employeeNo: string | null;
  name: string;
  department: string | null;
  position: string | null;
  grade: string | null;
};

/**
 * 人员初始化配置工具（新增 + 批量导入）。
 * 系统管理员集中维护人员主数据（工号/姓名/部门/岗位/职级）。
 */
export function PeopleTools() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    employeeNo: "",
    name: "",
    department: "",
    position: "",
    grade: "",
  });
  const [busy, setBusy] = useState<"create" | "import" | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data.error ?? "新增失败" });
        return;
      }
      setNotice({
        kind: "ok",
        text: `已新增：${data.user.name}（${data.user.employeeNo}）`,
      });
      setForm({
        employeeNo: "",
        name: "",
        department: "",
        position: "",
        grade: "",
      });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "网络错误，请重试" });
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setNotice({ kind: "err", text: "请先选择 Excel 文件" });
      return;
    }
    setBusy("import");
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data.error ?? "导入失败" });
        return;
      }
      const errCount = data.errors?.length ?? 0;
      setNotice({
        kind: "ok",
        text: `导入完成：新增 ${data.created} 人，跳过 ${errCount} 行（共 ${data.total} 行有效）`,
      });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "网络错误，请重试" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <h2 className="mb-2 text-sm font-semibold">新增人员</h2>
        <form
          onSubmit={handleCreate}
          data-testid="person-create-form"
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="pe-no">工号</Label>
              <Input
                id="pe-no"
                value={form.employeeNo}
                onChange={(e) =>
                  setForm({ ...form, employeeNo: e.target.value })
                }
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pe-name">姓名</Label>
              <Input
                id="pe-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pe-dept">部门</Label>
              <Input
                id="pe-dept"
                value={form.department}
                onChange={(e) =>
                  setForm({ ...form, department: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pe-pos">岗位</Label>
              <Input
                id="pe-pos"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pe-grade">职级</Label>
              <Input
                id="pe-grade"
                value={form.grade}
                onChange={(e) => setForm({ ...form, grade: e.target.value })}
              />
            </div>
            <div className="space-y-1 self-end">
              <Button type="submit" disabled={busy !== null} className="w-full">
                {busy === "create" ? "新增中…" : "新增"}
              </Button>
            </div>
          </div>
        </form>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-1 text-sm font-semibold">批量导入</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          模板列（固定顺序）：工号 / 姓名 / 部门 / 岗位 / 职级，第一行为表头。
          已存在的工号会被跳过。
        </p>
        <form
          onSubmit={handleImport}
          data-testid="person-bulk-form"
          className="flex flex-wrap items-center gap-2"
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="text-sm"
            aria-label="选择人员 Excel"
          />
          <Button type="submit" variant="outline" disabled={busy !== null}>
            {busy === "import" ? "导入中…" : "导入"}
          </Button>
        </form>
      </div>

      {notice && (
        <p
          className={
            notice.kind === "ok"
              ? "rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
          }
        >
          {notice.text}
        </p>
      )}
      {notice && notice.kind === "err" && null}
    </div>
  );
}

/** 行内编辑人员信息（姓名/部门/岗位/职级），展开式 */
export function PersonRowEditor({ person }: { person: PersonRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: person.name,
    department: person.department ?? "",
    position: person.position ?? "",
    grade: person.grade ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "保存失败");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "收起" : "编辑"}
      </Button>
      {open && (
        <form
          onSubmit={handleSave}
          data-testid="person-edit-form"
          className="bg-background absolute z-10 mt-1 w-64 space-y-2 rounded-md border p-3 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-1">
            <Label htmlFor={`pe-edit-name-${person.id}`}>姓名</Label>
            <Input
              id={`pe-edit-name-${person.id}`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={64}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pe-edit-dept-${person.id}`}>部门</Label>
            <Input
              id={`pe-edit-dept-${person.id}`}
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pe-edit-pos-${person.id}`}>岗位</Label>
            <Input
              id={`pe-edit-pos-${person.id}`}
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pe-edit-grade-${person.id}`}>职级</Label>
            <Input
              id={`pe-edit-grade-${person.id}`}
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
            />
          </div>
          {err && (
            <p className="text-destructive bg-destructive/10 rounded px-2 py-1 text-xs">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
