import type { User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AppHeader, type NavUser } from "./app-header";

/** 内容容器宽度：默认 6xl；数据密集页（矩阵评价）用 wide；表单/登录用 narrow */
const CONTAINER = {
  default: "max-w-6xl",
  wide: "max-w-7xl",
  narrow: "max-w-3xl",
} as const;

export type AppShellWidth = keyof typeof CONTAINER;

async function toNavUser(user: User): Promise<NavUser> {
  const isSystemAdmin = user.systemRole === "SYSTEM_ADMIN";
  const isProjectAdmin =
    isSystemAdmin ||
    (await prisma.projectAdmin.count({ where: { userId: user.id } })) > 0;
  return {
    name: user.name,
    roleLabel: isSystemAdmin
      ? "系统管理员"
      : isProjectAdmin
        ? "HR 项目管理员"
        : "评价人",
    isSystemAdmin,
    isProjectAdmin,
  };
}

/**
 * 全站统一外壳（AGENTS 目录约定：页面与 API 在 app/，UI 组件在 components/）：
 * 顶栏（品牌 + 角色导航 + 用户/退出）+ 统一宽度内容容器 + 页脚。
 * 未登录页面（落地页/登录页）传 user={null}，顶栏只显示品牌与登录入口。
 */
export async function AppShell({
  user = null,
  width = "default",
  bottomSpace = false,
  children,
}: {
  user?: User | null;
  width?: AppShellWidth;
  /** 页面有吸底操作栏时预留底部空间 */
  bottomSpace?: boolean;
  children: React.ReactNode;
}) {
  const containerClass = CONTAINER[width];
  const navUser = user ? await toNavUser(user) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={navUser} containerClass={containerClass} />
      <main
        className={`mx-auto w-full flex-1 space-y-5 px-4 py-6 sm:px-6 ${containerClass} ${
          bottomSpace ? "pb-28" : ""
        }`}
      >
        {children}
      </main>
      <footer
        className={`text-muted-foreground mx-auto w-full px-4 py-6 text-xs sm:px-6 ${containerClass}`}
      >
        Talent 360 · 企业内部 360 度测评平台
      </footer>
    </div>
  );
}
