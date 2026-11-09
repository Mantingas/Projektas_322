import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      risk: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
      opportunity: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
      info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
      warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export const Badge = ({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ tone }), className)} {...p} />
);
