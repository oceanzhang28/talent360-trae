import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentUser } from "@/modules/auth/service";
import { listProjects } from "@/modules/projects/service";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  formatDateTime,
} from "@/modules/projects/status";

export const metadata = {
  title: "项目管理 · Talent 360",
};

export default async function ProjectsPage() {
  // 服务端权限校验（AGENTS 铁律 9）：登录即可访问；
  // 列表由 service 按角色过滤（系统管理员看所有，HR 只看自己管理的）
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const projects = await listProjects(user);

  return (
    <AppShell user={user}>
      <PageHeader
        breadcrumbs={[{ label: "工作台", href: "/" }]}
        title="项目管理"
        description={
          user.systemRole === "SYSTEM_ADMIN"
            ? "系统管理员可查看所有项目"
            : "仅显示您管理的项目；创建项目后自动成为项目管理员"
        }
        actions={
          <Button asChild size="sm">
            <Link href="/projects/new">新建项目</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>项目列表（{projects.length}）</CardTitle>
          <CardDescription>
            进入项目后可管理问卷、人员与评价关系、进度看板与结果后台
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              还没有项目，点击右上角“新建项目”开始配置
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>截止时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/projects/${p.id}`}
                        className="hover:underline"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[p.status]}>
                        {STATUS_LABEL[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(p.startAt)}</TableCell>
                    <TableCell>{formatDateTime(p.endAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/projects/${p.id}`}>设置</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
