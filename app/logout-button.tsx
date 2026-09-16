"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
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
      className="hover:bg-accent inline-flex h-9 w-full items-center justify-center rounded-md border px-4 text-sm font-medium disabled:opacity-50"
    >
      {loading ? "退出中…" : "退出登录"}
    </button>
  );
}
