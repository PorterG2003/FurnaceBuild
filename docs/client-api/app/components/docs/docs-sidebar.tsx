'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { isNavActive, navHref } from '@/lib/docs-section'
import type { Root, Node } from 'fumadocs-core/page-tree'

interface DocsSidebarProps {
  tree: Root
}

export function DocsSidebar({ tree }: DocsSidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="docs-sidebar hidden lg:block w-64 shrink-0 pr-4">
      <nav className="sticky top-36 max-h-[calc(100vh-10rem)] overflow-y-auto pb-10 pr-4">
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
  const isActive = isNavActive(pathname, href)

  return (
    <li className="list-none">
      <a
        href={href}
        className={cn(
          'flex items-center gap-2 py-1 px-2 text-sm transition-colors rounded-md',
          isActive
            ? 'text-[var(--accent)] font-medium bg-[var(--accent-muted)]'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <span>{node.name}</span>
      </a>
    </li>
  )
}
