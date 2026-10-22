import type { HTMLAttributes, ReactNode } from 'react'

type Size = 'md' | 'lg' | 'xl'

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: Size
  children: ReactNode
}

const SIZE_CLASSES: Record<Size, string> = {
  md: 'max-w-md',
  lg: 'max-w-3xl',
  xl: 'max-w-6xl',
}

function Container({ size = 'md', className = '', children, ...rest }: ContainerProps) {
  return (
    <div className={`mx-auto w-full px-4 ${SIZE_CLASSES[size]} ${className}`} {...rest}>
      {children}
    </div>
  )
}

export default Container
