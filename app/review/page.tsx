import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/modules/auth/service";
import {
  listMyTasks,
  RELATION_LABELS,
  type MyTaskItem,
} from "@/modules/review-tasks/service";

export const metadata = {
  title: "我的评价 | Talent 360",
};

const STATUS_LABELS: Record<MyTaskItem["status"], string> = {
  NOT_STARTED: "待评价",
  IN_PROGRESS: "进行中",
  SUBMITTED: "已完成",
  RETURNED: "已退回",
};

function statusBadge(status: MyTaskItem["status"]) {
  const cls =
    status === "SUBMITTED"
      ? "bg-emerald-100 text-emerald-800"
      : status === "RETURNED"
        ? "bg-amber-100 text-amber-800"
        : status === "IN_PROGRESS"
          ? "bg-blue-100 text-blue-800"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export default async function ReviewPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const my = await listMyTasks(user);
  const visibleGroups = my.groups.filter((g) => g.tasks.length > 0);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的评价</h1>
          <p className="text-muted-foreground text-sm">
            共 {my.counts.total} 份 · 待评价 {my.counts.notStarted} · 进行中{" "}
            {my.counts.inProgress} · 已退回 {my.counts.returned} · 已完成{" "}
            {my.counts.submitted}
          </p>
        </div>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回首页
        </Link>
      </div>

      {visibleGroups.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            当前没有评价任务。
          </CardContent>
        </Card>
      ) : (
        visibleGroups.map((group) => (
          <section key={group.relationType} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {RELATION_LABELS[group.relationType]}评价
              <Badge variant="outline">{group.tasks.length}</Badge>
              <Link
                href={`/review/matrix?relation=${group.relationType}`}
                className="text-primary text-xs font-normal underline-offset-2 hover:underline"
                data-testid={`matrix-entry-${group.relationType}`}
              >
                矩阵模式
              </Link>
            </h2>
            <div className="space-y-2">
              {group.tasks.map((task) => (
                <Link key={task.taskId} href={`/review/${task.taskId}`}>
                  <Card className="hover:bg-accent/50 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">
                          {task.reviewee.name}
                          {task.reviewee.department
                            ? ` · ${task.reviewee.department}`
                            : ""}
                        </CardTitle>
                        {statusBadge(task.status)}
                      </div>
                      <CardDescription className="text-xs">
                        {task.project.name}
                        {task.project.endAt
                          ? ` · 截止 ${new Date(task.project.endAt).toLocaleDateString("zh-CN")}`
                          : ""}
                        {task.status === "RETURNED"
                          ? " · 请修改后重新提交"
                          : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-muted-foreground pt-0 text-xs">
                      工号 {task.reviewee.employeeNo}
                      {task.reviewee.position
                        ? ` · ${task.reviewee.position}`
                        : ""}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
