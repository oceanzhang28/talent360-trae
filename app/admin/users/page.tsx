import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
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
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/modules/auth/service";
import { PeopleTools, PersonRowEditor } from "./people-manager";
import { RoleToggle } from "./role-toggle";

export const metadata = {
  title: "用户管理 · Talent 360",
};

export default async function AdminUsersPage() {
  // 服务端权限校验（AGENTS 铁律 9）
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.systemRole !== "SYSTEM_ADMIN") redirect("/");

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <AppShell user={user}>
      <PageHeader
        breadcrumbs={[{ label: "工作台", href: "/" }]}
        title="用户管理"
        description="集中维护员工主数据与系统角色；HR 导入评价关系时可复用部门/岗位/职级"
      />
      <PeopleTools />
      <Card>
        <CardHeader>
          <CardTitle>系统用户（{users.length}）</CardTitle>
          <CardDescription>
            系统管理员可设置/取消系统管理员角色，并可编辑人员基础信息（姓名/部门/岗位/职级）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>工号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>岗位</TableHead>
                <TableHead>职级</TableHead>
                <TableHead>飞书绑定</TableHead>
                <TableHead>角色</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.employeeNo ?? "-"}
                  </TableCell>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.department ?? "-"}</TableCell>
                  <TableCell>{u.position ?? "-"}</TableCell>
                  <TableCell>{u.grade ?? "-"}</TableCell>
                  <TableCell>{u.feishuOpenId ? "已绑定" : "-"}</TableCell>
                  <TableCell>
                    {u.systemRole === "SYSTEM_ADMIN"
                      ? "系统管理员"
                      : "普通用户"}
                  </TableCell>
                  <TableCell className="relative text-right">
                    <PersonRowEditor person={u} />
                    <RoleToggle
                      userId={u.id}
                      systemRole={u.systemRole}
                      disabled={u.id === user.id}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
