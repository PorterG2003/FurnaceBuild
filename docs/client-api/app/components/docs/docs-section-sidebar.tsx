'use client'

import { usePathname } from 'next/navigation'
import { getDocsSection } from '@/lib/docs-section'
import { DocsSidebar } from './docs-sidebar'
import type { Root } from 'fumadocs-core/page-tree'

type DocsSectionSidebarProps = {
  docsTree: Root
  referenceTree: Root
}

export function DocsSectionSidebar({ docsTree, referenceTree }: DocsSectionSidebarProps) {
  const pathname = usePathname()
  const section = getDocsSection(pathname)
  const tree = section === 'reference' ? referenceTree : docsTree

  return <DocsSidebar tree={tree} />
}
