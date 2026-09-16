"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 项目级常驻导航（PRD 第 16~38 节的各项目页面） */
const TABS = [
  { seg: "", label: "项目设置" },
  { seg: "people", label: "人员与关系" },
  { seg: "questionnaire", label: "问卷预览" },
  { seg: "progress", label: "进度看板" },
  { seg: "results", label: "结果后台" },
] as const;

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav
      aria-label="项目导航"
      className="flex gap-1 overflow-x-auto border-b"
      data-testid="project-nav"
    >
      {TABS.map((tab) => {
        const href = tab.seg ? `${base}/${tab.seg}` : base;
        const active = tab.seg
          ? pathname.startsWith(`${base}/${tab.seg}`)
          : pathname === base;
        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active
                ? "border-primary text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
