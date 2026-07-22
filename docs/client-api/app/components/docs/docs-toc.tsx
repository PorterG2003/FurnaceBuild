'use client'

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { TOCItemType } from 'fumadocs-core/toc'

interface DocsTOCProps {
  /** When empty/undefined, the rail is still reserved (spacer). */
  toc?: TOCItemType[] | null
}

function tocId(url: string): string {
  return url.startsWith('#') ? url.slice(1) : url
}

export function DocsTOC({ toc }: DocsTOCProps) {
  const items = toc ?? []
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (items.length === 0) return

    const headings = [...document.querySelectorAll<HTMLElement>('h2[id], h3[id]')].filter(
      (heading) => heading.id.length > 0,
    )
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target instanceof HTMLElement && visible[0].target.id) {
          setActiveId(visible[0].target.id)
        }
      },
      // Offset for sticky header + tabs (matches html scroll-padding-top: 9rem)
      { rootMargin: '-144px 0px -66% 0px', threshold: [0, 1] },
    )

    headings.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [items])

  function handleClick(event: MouseEvent<HTMLAnchorElement>, url: string) {
    const id = tocId(url)
    const target = document.getElementById(id)
    if (!target) return

    event.preventDefault()
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.pushState(null, '', `#${id}`)
    setActiveId(id)
  }

  return (
    <aside className="min-w-0" aria-hidden={items.length === 0}>
      {items.length > 0 ? (
        <nav className="sticky top-36 max-h-[calc(100vh-10rem)] overflow-y-auto overflow-x-hidden">
          <p className="text-sm font-semibold text-foreground mb-4">On this page</p>
          <ul className="space-y-2 text-sm">
            {items.map((item) => {
              const id = tocId(item.url)
              return (
                <li key={item.url}>
                  <a
                    href={item.url}
                    onClick={(event) => handleClick(event, item.url)}
                    className={cn(
                      'block py-1 transition-colors break-words',
                      item.depth === 3 && 'pl-4',
                      activeId === id
                        ? 'text-[var(--accent)] font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {item.title}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}
    </aside>
  )
}

/**
 * Shared page frame: middle column + permanent right rail.
 * Uses fixed CSS grid tracks so wide content (tables, code) cannot shift chrome.
 */
export function DocsPageFrame({
  children,
  toc,
}: {
  children: ReactNode
  toc?: TOCItemType[] | null
}) {
  return (
    <div className="grid w-full gap-8 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="min-w-0 w-full">{children}</div>
      <div className="hidden xl:block min-w-0">
        <DocsTOC toc={toc} />
      </div>
    </div>
  )
}
