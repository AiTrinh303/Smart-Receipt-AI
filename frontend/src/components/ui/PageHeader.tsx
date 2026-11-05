import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

/** The one `<h1>` for a page, plus an optional muted description and an
 * actions slot. Actions sit to the right of the title from `sm` up, and
 * stack below it on narrow screens. Exactly one `PageHeader` (and so
 * exactly one `<h1>`) is expected per view. */
function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-title text-ink">{title}</h1>
        {description && <p className="max-w-prose text-base text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export default PageHeader
