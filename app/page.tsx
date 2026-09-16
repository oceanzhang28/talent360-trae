import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
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
import { STATUS_LABEL } from "@/modules/projects/status";

export const metadata = {
  title: "Talent 360 | 360测评平台",
};

/** 未登录：落地页（品牌叙事 + 登录入口） */
function LandingPage() {
  const features = [
    {
      title: "360° 多视角反馈",
      desc: "自评、上级、平级、下级四类视角分别计分，自评不参与总分。",
    },
    {
      title: "Excel 全流程导入",
      desc: "问卷与评价关系沿用官方模板，导入前预检查，失败整批回滚。",
    },
    {
      title: "结果可冻结存档",
      desc: "截止后固化快照，导出 6 张固定格式报表，历史记录不可篡改。",
    },
  ];

  return (
    <>
      <section className="py-10 sm:py-16">
        <p className="text-primary text-sm font-medium tracking-widest">
          企业内部 · 360 度测评
        </p>
        <h1 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          让每一份反馈，成为成长的起点
        </h1>
        <p className="text-muted-foreground mt-5 max-w-xl text-sm leading-7 sm:text-base">
          汇集不同视角，理解优势与成长空间，为团队发展提供清晰、可信的参考。
        </p>
        <Link
          href="/login"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-8 inline-flex h-10 items-center justify-center rounded-md px-5 text-sm font-medium"
        >
          登录 Talent 360
        </Link>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle className="text-base">{f.title}</CardTitle>
              <CardDescription className="leading-6">{f.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </>
  );
}

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AppShell>
        <LandingPage />
      </AppShell>
    );
  }

  const isAdmin =
    user.systemRole === "SYSTEM_ADMIN" ||
    (await prisma.projectAdmin.count({ where: { userId: user.id } })) > 0;

  // 我的待评价（Sprint 5）：待评价/进行中/已退回/已完成
  const my = await listMyTasks(user);
  const pendingCount =
    my.counts.notStarted + my.counts.inProgress + my.counts.returned;

  const projects = isAdmin
    ? await prisma.project.findMany({
        where: {
          deletedAt: null,
          status: { not: "DELETED" },
          ...(user.systemRole === "SYSTEM_ADMIN"
            ? {}
            : { admins: { some: { userId: user.id } } }),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, status: true },
      })
    : [];

  return (
    <AppShell user={user}>
      <PageHeader
        title={`你好，${user.name}`}
        description={`${user.systemRole === "SYSTEM_ADMIN" ? "系统管理员" : isAdmin ? "HR 项目管理员" : "评价人"} · 工号 ${user.employeeNo ?? "-"}`}
      />

      <section aria-labelledby="my-tasks-title" className="space-y-3">
        <h2 id="my-tasks-title" className="text-base font-semibold">
          我的待评价
        </h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {pendingCount > 0
                ? `您有 ${pendingCount} 份评价待完成`
                : "当前没有待完成的评价"}
            </CardTitle>
            <CardDescription>
              共 {my.counts.total} 份任务 · 作答自动保存草稿，提交后不可修改
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-4 gap-3 text-center">
              <div className="bg-muted/50 rounded-md py-3">
                <dd className="text-xl font-bold">{my.counts.notStarted}</dd>
                <dt className="text-muted-foreground text-xs">待评价</dt>
              </div>
              <div className="bg-muted/50 rounded-md py-3">
                <dd className="text-xl font-bold">{my.counts.inProgress}</dd>
                <dt className="text-muted-foreground text-xs">进行中</dt>
              </div>
              <div className="bg-muted/50 rounded-md py-3">
                <dd className="text-xl font-bold">{my.counts.returned}</dd>
                <dt className="text-muted-foreground text-xs">已退回</dt>
              </div>
              <div className="bg-muted/50 rounded-md py-3">
                <dd className="text-xl font-bold">{my.counts.submitted}</dd>
                <dt className="text-muted-foreground text-xs">已完成</dt>
              </div>
            </dl>
            <Link
              href="/review"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium"
            >
              进入评价（共 {my.counts.total} 份）
            </Link>
          </CardContent>
        </Card>
      </section>

      {isAdmin && (
        <section aria-labelledby="my-projects-title" className="space-y-3">
          <h2 id="my-projects-title" className="text-base font-semibold">
            我管理的项目
          </h2>
          <Card>
            <CardContent>
              {projects.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  还没有项目，进入项目列表新建第一个测评项目。
                </p>
              ) : (
                <ul className="divide-y">
                  {projects.map((project) => (
                    <li
                      key={project.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                    >
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium hover:underline"
                      >
                        {project.name}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {STATUS_LABEL[project.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </AppShell>
  );
}
