import type { Project } from "@/app/generated/prisma/client";

/** 项目状态中文标签（纯常量，客户端组件可安全引用） */
export const STATUS_LABEL: Record<Project["status"], string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ACTIVE: "测评中",
  CLOSED: "已截止",
  FROZEN: "已冻结",
  ARCHIVED: "已归档",
  DELETED: "已删除",
};

/** badge 颜色变体 */
export const STATUS_BADGE: Record<
  Project["status"],
  "secondary" | "default" | "outline" | "destructive"
> = {
  DRAFT: "secondary",
  PUBLISHED: "outline",
  ACTIVE: "default",
  CLOSED: "outline",
  FROZEN: "default",
  ARCHIVED: "outline",
  DELETED: "destructive",
};

export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** datetime-local 输入框初值（本地时间，精确到分钟） */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
