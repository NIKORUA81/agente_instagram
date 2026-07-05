'use client';

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900',
          'placeholder:text-neutral-400',
          'focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100',
          'disabled:cursor-not-allowed disabled:bg-neutral-100',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900',
          'focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100',
          'disabled:cursor-not-allowed disabled:bg-neutral-100',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Label({
  htmlFor,
  children,
  className,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-sm font-medium text-neutral-700', className)}>
      {children}
    </label>
  );
}
