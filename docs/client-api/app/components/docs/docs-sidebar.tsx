'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { isNavActive, linkHref, navHref } from '@/lib/docs-section'
import type { Root, Node } from 'fumadocs-core/page-tree'

interface DocsSidebarProps {
  tree: Root
}

/** Module-level so soft navigations / remounts keep the same offset. */
let savedSidebarScrollTop = 0

export function DocsSidebar({ tree }: DocsSidebarProps) {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return

    nav.scrollTop = savedSidebarScrollTop

    const onScroll = () => {
      savedSidebarScrollTop = nav.scrollTop
    }
    nav.addEventListener('scroll', onScroll, { passive: true })
    return () => nav.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    if (nav.scrollTop !== savedSidebarScrollTop) {
      nav.scrollTop = savedSidebarScrollTop
    }
  }, [pathname])

  return (
    <aside className="docs-sidebar w-full min-w-0">
      <nav
        ref={navRef}
        className="sticky top-36 max-h-[calc(100vh-10rem)] overflow-y-auto overflow-x-hidden pb-10 pr-4"
      >
        <SidebarNodes nodes={tree.children} pathname={pathname} level={0} />
      </nav>
    </aside>
  )
}

interface SidebarNodesProps {
  nodes: Node[]
  pathname: string
  level: number
}

function SidebarNodes({ nodes, pathname, level }: SidebarNodesProps) {
  return (
    <div className="space-y-1">
      {nodes.map((node, index) => (
        <SidebarNode key={index} node={node} pathname={pathname} level={level} />
      ))}
    </div>
  )
}

interface SidebarNodeProps {
  node: Node
  pathname: string
  level: number
}

function SidebarNode({ node, pathname, level }: SidebarNodeProps) {
  if (node.type === 'separator') {
    return (
      <div className="pt-4 first:pt-0">
        <h5 className="text-sm font-semibold text-foreground mb-1.5">
          {node.name}
        </h5>
      </div>
    )
  }

  if (node.type === 'folder') {
    return (
      <div>
        <span className="block py-1 text-sm font-medium text-muted-foreground">
          {node.name}
        </span>
        {node.children && (
          <ul className="ml-3 mt-1 space-y-0.5 border-l border-border pl-3">
            {node.children.map((child, index) => (
              <SidebarNode key={index} node={child} pathname={pathname} level={level + 1} />
            ))}
          </ul>
        )}
      </div>
    )
  }

  const href = navHref(node.url)
  const nextHref = linkHref(node.url)
  const isActive = isNavActive(pathname, href)
  const isExternal =
    nextHref.startsWith('http://') ||
    nextHref.startsWith('https://') ||
    nextHref.startsWith('mailto:')

  const className = cn(
    'docs-nav-link flex items-center gap-2 py-1 px-2 text-sm transition-colors rounded-md min-w-0 overflow-hidden',
    isActive
      ? 'text-[var(--accent)] font-medium bg-[var(--accent-muted)]'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
  )

  return (
    <li className="list-none min-w-0">
      {isExternal ? (
        <a href={href} className={className}>
          {node.name}
        </a>
      ) : (
        <Link href={nextHref} className={className}>
          {node.name}
        </Link>
      )}
    </li>
  )
}
