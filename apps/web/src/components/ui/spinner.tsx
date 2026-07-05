import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-6 animate-spin text-brand-600', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Cargando"
      role="status"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
