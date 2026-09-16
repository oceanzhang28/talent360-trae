import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { getCurrentUser } from "@/modules/auth/service";
import { listDeletedProjects } from "@/modules/projects/service";
import { RecycleBinManager } from "./recycle-bin-manager";

export const metadata = {
  title: "回收站 · Talent 360",
};

/** 回收站（PRD 第 44 节）：仅系统管理员可访问 */
export default async function RecycleBinPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.systemRole !== "SYSTEM_ADMIN") redirect("/projects");

  const projects = await listDeletedProjects(user);

  return (
    <AppShell user={user}>
      <PageHeader
        breadcrumbs={[{ label: "项目管理", href: "/projects" }]}
        title="回收站"
        description="删除的项目在此保留 30 天；期间可恢复，超过 30 天可彻底清理"
        actions={
          <Link
            href="/projects"
            className="hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium"
          >
            返回项目列表
          </Link>
        }
      />
      <RecycleBinManager projects={projects} />
    </AppShell>
  );
}
