import { cn } from '@/lib/utils';

export function Alert({
  tone = 'error',
  children,
  className,
}: {
  tone?: 'error' | 'success' | 'info';
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    info: 'border-brand-100 bg-brand-50 text-brand-700',
  };
  return (
    <div role="alert" className={cn('rounded-lg border px-4 py-3 text-sm', tones[tone], className)}>
      {children}
    </div>
  );
}
