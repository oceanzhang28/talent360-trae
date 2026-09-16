import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
    <main className="mx-auto min-h-screen w-full max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">人员与评价关系</h1>
          <p className="text-muted-foreground text-sm">
            {project.name} · {people.length} 名人员 ·{" "}
            {relations.filter((r) => r.active).length} 条有效关系
          </p>
        </div>
        <Link
          href={`/projects/${id}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回项目设置
        </Link>
      </div>
      <PeopleManager
        projectId={id}
        selfReviewEnabled={project.selfReviewEnabled}
        initialPeople={people}
        initialRelations={relations}
      />
    </main>
  );
}
