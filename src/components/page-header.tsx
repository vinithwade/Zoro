export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-8 py-4">
      <div className="flex items-center gap-3">
        <h1 className="text-[15px] font-medium tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="hidden text-xs text-faint lg:block">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface px-6 py-16 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
