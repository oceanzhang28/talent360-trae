import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { getCurrentUser } from "@/modules/auth/service";
import { ProjectForm } from "./project-form";

export const metadata = {
  title: "新建项目 · Talent 360",
};

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} width="narrow">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "项目列表", href: "/projects" },
        ]}
        title="新建项目"
        description="创建后自动成为项目管理员，随后可导入问卷、配置人员与评价关系"
      />
      <ProjectForm />
    </AppShell>
  );
}
