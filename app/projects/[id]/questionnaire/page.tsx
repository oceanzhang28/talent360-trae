import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import { getProject } from "@/modules/projects/service";
import { getProjectQuestionnaire } from "@/modules/questionnaires/service";
import { RelationView } from "./relation-view";

export const metadata = {
  title: "问卷预览 · Talent 360",
};

/** 问卷只读预览页：按关系视角查看适用题目（PRD 第 11 节） */
export default async function QuestionnairePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let project: Awaited<ReturnType<typeof getProject>>["project"];
  let questionnaire: Awaited<ReturnType<typeof getProjectQuestionnaire>>;
  try {
    project = (await getProject(id, user)).project;
    questionnaire = await getProjectQuestionnaire(id, user);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) notFound();
      redirect("/");
    }
    throw err;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">问卷预览</h1>
          <p className="text-muted-foreground text-sm">{project.name}</p>
        </div>
        <Link
          href={`/projects/${id}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回项目设置
        </Link>
      </div>

      {questionnaire ? (
        <RelationView questionnaire={questionnaire} />
      ) : (
        <p className="text-muted-foreground rounded-md border p-4 text-sm">
          该项目尚未导入问卷。
        </p>
      )}
    </main>
  );
}
