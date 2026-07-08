'use client'

import { usePathname } from 'next/navigation'
import { getDocsSection, navHref } from '@/lib/docs-section'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'Documentation', href: '/docs/', section: 'docs' as const },
  { label: 'API Reference', href: '/docs/reference/', section: 'reference' as const },
]

export function DocsNavTabs() {
  const pathname = usePathname()
  const activeSection = getDocsSection(pathname)

  return (
    <div className="docs-nav-tabs flex px-4 sm:px-6 lg:px-8 h-12 border-b border-border">
      <div className="max-w-7xl mx-auto w-full flex items-stretch gap-6">
        {tabs.map((tab) => {
          const isActive = activeSection === tab.section
          return (
            <a
              key={tab.section}
              href={navHref(tab.href)}
              data-active={isActive ? 'true' : 'false'}
              aria-current={isActive ? 'location' : undefined}
              className={cn('docs-nav-tab')}
            >
              {tab.label}
            </a>
          )
        })}
      </div>
    </div>
  )
}
