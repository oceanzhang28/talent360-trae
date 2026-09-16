import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/modules/auth/service";
import { listMyTasks } from "@/modules/review-tasks/service";
import { LogoutButton } from "./logout-button";

export const metadata = {
  title: "Talent 360 | 360测评平台",
};

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Talent 360</h1>
          <p className="text-muted-foreground mt-2">企业内部 360 测评平台</p>
        </div>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>欢迎使用</CardTitle>
            <CardDescription>
              请使用企业身份登录后查看您的测评任务
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/login"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
            >
              去登录
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  // 项目管理入口：系统管理员或至少管理一个项目的 HR 可见
  const isAdmin =
    user.systemRole === "SYSTEM_ADMIN" ||
    (await prisma.projectAdmin.count({ where: { userId: user.id } })) > 0;

  // 我的待评价（Sprint 5）：待评价/进行中/已退回/已完成
  const my = await listMyTasks(user);
  const pendingCount =
    my.counts.notStarted + my.counts.inProgress + my.counts.returned;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>我的待评价</CardTitle>
          <CardDescription>
            {pendingCount > 0
              ? `您有 ${pendingCount} 份评价待完成`
              : "当前没有待完成的评价"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-4 gap-2 text-center">
            <div>
              <dd className="text-xl font-bold">{my.counts.notStarted}</dd>
              <dt className="text-muted-foreground text-xs">待评价</dt>
            </div>
            <div>
              <dd className="text-xl font-bold">{my.counts.inProgress}</dd>
              <dt className="text-muted-foreground text-xs">进行中</dt>
            </div>
            <div>
              <dd className="text-xl font-bold">{my.counts.returned}</dd>
              <dt className="text-muted-foreground text-xs">已退回</dt>
            </div>
            <div>
              <dd className="text-xl font-bold">{my.counts.submitted}</dd>
              <dt className="text-muted-foreground text-xs">已完成</dt>
            </div>
          </dl>
          <Link
            href="/review"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            进入评价（共 {my.counts.total} 份）
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>已登录</CardTitle>
          <CardDescription>当前登录身份</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">姓名</dt>
              <dd className="font-medium">{user.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">工号</dt>
              <dd className="font-medium">{user.employeeNo ?? "-"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">角色</dt>
              <dd className="font-medium">
                {user.systemRole === "SYSTEM_ADMIN" ? "系统管理员" : "普通用户"}
              </dd>
            </div>
          </dl>
          {user.systemRole === "SYSTEM_ADMIN" && (
            <Link
              href="/admin/users"
              className="hover:bg-accent inline-flex h-9 w-full items-center justify-center rounded-md border px-4 text-sm font-medium"
            >
              用户管理
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/projects"
              className="hover:bg-accent inline-flex h-9 w-full items-center justify-center rounded-md border px-4 text-sm font-medium"
            >
              项目管理
            </Link>
          )}
          <LogoutButton />
        </CardContent>
      </Card>
    </main>
  );
}
