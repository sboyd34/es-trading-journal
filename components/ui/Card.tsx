import * as React from 'react'
import { cn } from '@/lib/utils'

type CardProps = React.HTMLAttributes<HTMLDivElement>

function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-gray-800/50 backdrop-blur border border-gray-700/50 rounded-xl',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>

function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn('px-5 py-4 border-b border-gray-700/50', className)}
      {...props}
    >
      {children}
    </div>
  )
}

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement>

function CardTitle({ className, children, ...props }: CardTitleProps) {
  return (
    <h3
      className={cn('text-sm font-semibold text-gray-200 tracking-wide', className)}
      {...props}
    >
      {children}
    </h3>
  )
}

type CardContentProps = React.HTMLAttributes<HTMLDivElement>

function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={cn('px-5 py-4', className)} {...props}>
      {children}
    </div>
  )
}

export { Card, CardHeader, CardTitle, CardContent }
