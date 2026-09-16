import Link from "next/link";
import { redirect } from "next/navigation";
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
    <main className="mx-auto min-h-screen w-full max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">用户管理</h1>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回首页
        </Link>
      </div>
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
    </main>
  );
}
