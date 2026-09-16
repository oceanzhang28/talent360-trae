"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

/** 顶栏所需的最小用户信息（由 AppShell 在服务端组装） */
export type NavUser = {
  name: string;
  roleLabel: string;
  isSystemAdmin: boolean;
  isProjectAdmin: boolean;
};

type NavItem = {
  href: string;
  label: string;
  visible: boolean;
  /** 仅精确匹配当前路径（工作台首页） */
  exact?: boolean;
};

/** 全站顶栏：品牌 + 角色感知主导航 + 用户信息/退出 */
export function AppHeader({
  user,
  containerClass,
}: {
  user: NavUser | null;
  containerClass: string;
}) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/", label: "工作台", visible: true, exact: true },
    { href: "/review", label: "我的评价", visible: Boolean(user) },
    {
      href: "/projects",
      label: "项目管理",
      visible: Boolean(user?.isProjectAdmin),
    },
    {
      href: "/admin/users",
      label: "用户管理",
      visible: Boolean(user?.isSystemAdmin),
    },
  ];

  return (
    <header className="bg-background/95 sticky top-0 z-20 border-b backdrop-blur">
      <div
        className={`mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 ${containerClass}`}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-xs font-semibold"
          >
            360
          </span>
          <span className="font-semibold tracking-tight">Talent 360</span>
        </Link>

        <nav
          aria-label="主导航"
          className="order-3 flex w-full items-center gap-1 overflow-x-auto text-sm sm:order-none sm:ml-6 sm:w-auto"
        >
          {items
            .filter((item) => item.visible)
            .map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded-md px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <span className="text-right leading-tight">
                <span className="block text-sm font-medium">{user.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {user.roleLabel}
                </span>
              </span>
              <LogoutButton className="hover:bg-accent inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm font-medium disabled:opacity-50" />
            </>
          ) : (
            pathname !== "/login" && (
              <Link
                href="/login"
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium"
              >
                登录
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
