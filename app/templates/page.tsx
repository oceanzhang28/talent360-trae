import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { getCurrentUser } from "@/modules/auth/service";
import { listTemplates } from "@/modules/questionnaires/service";
import { TemplatesManager } from "./templates-manager";

export const metadata = {
  title: "问卷模板库 · Talent 360",
};

/** 问卷模板库（PRD 第 13 节）：所有登录用户可查看与引用模板 */
export default async function TemplatesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const templates = (await listTemplates()).map((t) => ({
    ...t,
    canManage: user.systemRole === "SYSTEM_ADMIN" || t.createdById === user.id,
  }));

  return (
    <AppShell user={user}>
      <PageHeader
        breadcrumbs={[{ label: "首页", href: "/" }]}
        title="问卷模板库"
        description="保存过的问卷模板可被新项目直接复制；改名/删除限创建者或系统管理员"
      />
      <TemplatesManager templates={templates} />
    </AppShell>
  );
}
