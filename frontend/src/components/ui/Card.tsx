import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-card border border-border-subtle bg-surface p-5 shadow-card sm:p-6 ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export default Card
