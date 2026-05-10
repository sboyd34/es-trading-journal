import * as React from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple'
}

function Badge({ className, variant = 'gray', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        {
          'bg-emerald-400/10 text-emerald-400': variant === 'green',
          'bg-red-400/10 text-red-400': variant === 'red',
          'bg-yellow-400/10 text-yellow-400': variant === 'yellow',
          'bg-blue-400/10 text-blue-400': variant === 'blue',
          'bg-gray-400/10 text-gray-400': variant === 'gray',
          'bg-purple-400/10 text-purple-400': variant === 'purple',
        },
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export { Badge }
export type { BadgeProps }
