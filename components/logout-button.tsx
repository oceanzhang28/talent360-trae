"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 退出登录按钮：默认块级（卡片内使用），传 className 可改为行内紧凑样式（顶栏使用） */
export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className={
        className ??
        "hover:bg-accent inline-flex h-9 w-full items-center justify-center rounded-md border px-4 text-sm font-medium disabled:opacity-50"
      }
    >
      {loading ? "退出中…" : "退出登录"}
    </button>
  );
}
