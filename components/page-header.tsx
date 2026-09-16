import Link from "next/link";

export type Crumb = {
  label: string;
  href?: string;
};

/** 面包屑：末级不带 href，用 aria-current 标识当前位置 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="面包屑" className="text-muted-foreground text-xs">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** 统一页头：面包屑 + 标题（可带徽标） + 描述 + 右侧操作区 */
export function PageHeader({
  title,
  description,
  badge,
  breadcrumbs,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumbs items={breadcrumbs} />
        )}
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
          {title}
          {badge}
        </h1>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
