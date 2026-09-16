"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RoleToggle({
  userId,
  systemRole,
  disabled,
}: {
  userId: string;
  systemRole: "USER" | "SYSTEM_ADMIN";
  disabled: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isAdmin = systemRole === "SYSTEM_ADMIN";

  async function handleToggle() {
    setLoading(true);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemRole: isAdmin ? "USER" : "SYSTEM_ADMIN" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "操作失败");
    }
    router.refresh();
    setLoading(false);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleToggle}
      disabled={disabled || loading}
      title={disabled ? "不能修改自己的角色" : undefined}
    >
      {loading ? "处理中…" : isAdmin ? "取消管理员" : "设为管理员"}
    </Button>
  );
}
