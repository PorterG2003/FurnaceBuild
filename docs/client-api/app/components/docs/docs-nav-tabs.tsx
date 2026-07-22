'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getDocsSection, linkHref } from '@/lib/docs-section'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'Documentation', href: '/', section: 'docs' as const },
  { label: 'API Reference', href: '/reference/', section: 'reference' as const },
]

export function DocsNavTabs() {
  const pathname = usePathname()
  const activeSection = getDocsSection(pathname)

  return (
    <div className="docs-nav-tabs h-12 border-b border-border">
      <div className="max-w-[90rem] mx-auto h-full w-full px-4 sm:px-6 lg:px-8 flex items-stretch gap-6">
        {tabs.map((tab) => {
          const isActive = activeSection === tab.section
          return (
            <Link
              key={tab.section}
              href={linkHref(tab.href)}
              data-active={isActive ? 'true' : 'false'}
              aria-current={isActive ? 'location' : undefined}
              className={cn('docs-nav-tab')}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
