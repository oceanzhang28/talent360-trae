import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProjectNav } from "@/components/project-nav";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProject } from "@/modules/projects/service";
import { listPeople, listRelations } from "@/modules/review-relations/service";
import { PeopleManager } from "./people-manager";

export const metadata = {
  title: "人员与关系 · Talent 360",
};

/** HR 人员与关系管理页（PRD 第 16~20 节） */
export default async function PeoplePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let project: Awaited<ReturnType<typeof getProject>>["project"];
  let people: Awaited<ReturnType<typeof listPeople>>;
  let relations: Awaited<ReturnType<typeof listRelations>>;
  try {
    project = (await getProject(id, user)).project;
    [people, relations] = await Promise.all([
      listPeople(id, user),
      listRelations(id, user),
    ]);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) notFound();
      redirect("/");
    }
    throw err;
  }

  return (
    <AppShell user={user}>
      <ProjectNav projectId={id} />
      <PageHeader
        breadcrumbs={[
          { label: "项目列表", href: "/projects" },
          { label: project.name, href: `/projects/${id}` },
        ]}
        title="人员与评价关系"
        description={`${people.length} 名人员 · ${relations.filter((r) => r.active).length} 条有效关系 · Excel 两阶段导入或手工增删改`}
      />
      <PeopleManager
        projectId={id}
        selfReviewEnabled={project.selfReviewEnabled}
        initialPeople={people}
        initialRelations={relations}
      />
    </AppShell>
  );
}
