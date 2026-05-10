import * as React from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'danger' | 'success' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950',
          {
            // Variants
            'bg-blue-600 hover:bg-blue-500 text-white focus:ring-blue-500': variant === 'default',
            'bg-transparent hover:bg-gray-800 text-gray-300 hover:text-white focus:ring-gray-600': variant === 'ghost',
            'bg-red-600 hover:bg-red-500 text-white focus:ring-red-500': variant === 'danger',
            'bg-emerald-600 hover:bg-emerald-500 text-white focus:ring-emerald-500': variant === 'success',
            'bg-transparent border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white focus:ring-gray-600': variant === 'outline',
            // Sizes
            'text-xs px-2.5 py-1.5 gap-1': size === 'sm',
            'text-sm px-4 py-2 gap-2': size === 'md',
            'text-base px-6 py-3 gap-2': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'

export { Button }
export type { ButtonProps }
