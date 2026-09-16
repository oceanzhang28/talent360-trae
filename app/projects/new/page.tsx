import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/service";
import { ProjectForm } from "./project-form";

export const metadata = {
  title: "新建项目 · Talent 360",
};

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">新建项目</h1>
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          返回列表
        </Link>
      </div>
      <ProjectForm />
    </main>
  );
}
