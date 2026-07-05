import { cn } from '@/lib/utils';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-neutral-200 bg-white shadow-sm', className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-6 py-4', className)}>{children}</div>;
}
