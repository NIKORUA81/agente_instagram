import { cn } from '@/lib/utils';

const roleColors: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-brand-100 text-brand-700',
  agent: 'bg-emerald-100 text-emerald-700',
  analyst: 'bg-amber-100 text-amber-700',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        roleColors[tone] ?? 'bg-neutral-100 text-neutral-600',
        className,
      )}
    >
      {children}
    </span>
  );
}
