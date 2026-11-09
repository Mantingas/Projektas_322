import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

// Hand-written in the shadcn/ui style (cva + tailwind-merge). The shadcn CLI was not used.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-indigo-600 text-white hover:bg-indigo-700',
        outline: 'border border-slate-300 bg-transparent hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800',
        ghost: 'hover:bg-slate-100 dark:hover:bg-slate-800',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: { default: 'h-10 px-4 py-2', sm: 'h-8 px-3', lg: 'h-12 px-6 text-base' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
export { buttonVariants };
