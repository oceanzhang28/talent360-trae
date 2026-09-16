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

export function LoginForm({
  authMode,
  initialError,
}: {
  authMode: "mock" | "feishu";
  initialError: string | null;
}) {
  const router = useRouter();
  const [employeeNo, setEmployeeNo] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mock/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeNo, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "登录失败，请重试");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (authMode === "feishu") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>使用飞书企业身份登录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          )}
          <Button asChild className="w-full">
            <a href="/api/auth/feishu/start">使用飞书登录</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>登录（开发模式）</CardTitle>
        <CardDescription>
          AUTH_MODE=mock：输入工号与姓名模拟飞书身份，自动创建/更新用户
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="employeeNo">工号</Label>
            <Input
              id="employeeNo"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              placeholder="例如 00000"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">姓名</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 张三"
              required
            />
          </div>
          {error && (
            <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中…" : "登录"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
