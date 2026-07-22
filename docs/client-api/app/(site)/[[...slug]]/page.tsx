import { source, getTreeForSection } from '@/lib/docs-source'
import { notFound } from 'next/navigation'
import { DocsPageFrame } from '../../components/docs/docs-toc'
import { getMDXComponents } from '../../components/docs/mdx'
import type { Metadata } from 'next'
import type { Root, Node } from 'fumadocs-core/page-tree'
import { getSiteUrl, siteConfig } from '@/lib/theme-config'
import { OpenAPIPage } from '@/components/api-page'
import { SchemaModelPage } from '@/components/schema-model-page'
import { getSchemaDescription, getSchemaOperation } from '@/lib/schema-operations'
import { getDocsSection } from '@/lib/docs-section'
import { openapi, OPENAPI_DOCUMENT_ID } from '@/lib/openapi'

interface PageProps {
  params: Promise<{ slug?: string[] }>
}

function findSectionName(tree: Root, pageUrl: string): string {
  let lastSeparator = 'Documentation'

  function traverse(nodes: Node[]): string | null {
    for (const node of nodes) {
      if (node.type === 'separator') {
        lastSeparator = typeof node.name === 'string' ? node.name : 'Documentation'
      } else if (node.type === 'page' && node.url === pageUrl) {
        return lastSeparator
      } else if (node.type === 'folder' && node.children) {
        const result = traverse(node.children)
        if (result) return result
      }
    }
    return null
  }

  return traverse(tree.children) || lastSeparator
}

function findReferenceSectionName(tree: Root, pageUrl: string): string {
  function traverse(nodes: Node[], folderName = 'API Reference'): string | null {
    for (const node of nodes) {
      if (node.type === 'folder') {
        const result = traverse(node.children ?? [], String(node.name))
        if (result) return result
      } else if (node.type === 'page' && node.url === pageUrl) {
        return folderName
      }
    }
    return null
  }

  return traverse(tree.children) || 'API Reference'
}

export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params
  const page = source.getPage(slug)

  if (!page) notFound()

  const section = getDocsSection(page.url)
  const tree = getTreeForSection(section)
  const sectionName = section === 'reference'
    ? findReferenceSectionName(tree, page.url)
    : findSectionName(tree, page.url)

  if (page.type === 'schemas') {
    const schemaName = (page.data as { schemaName?: string }).schemaName
    if (!schemaName) notFound()

    const operation = getSchemaOperation(schemaName)
    const loaded = await openapi.getSchema(OPENAPI_DOCUMENT_ID)
    if (!operation) notFound()

    return (
      <DocsPageFrame>
        <article className="w-full min-w-0 max-w-3xl">
          <header className="mb-8 pb-6 border-b border-border">
            <p className="text-sm text-[var(--accent)] font-medium mb-2">{sectionName}</p>
            <h1 className="text-3xl font-bold text-foreground">{page.data.title}</h1>
            {page.data.description ? (
              <p className="mt-3 text-base text-muted-foreground">{page.data.description}</p>
            ) : null}
          </header>
          <SchemaModelPage
            name={schemaName}
            operation={operation}
            bundled={loaded.bundled}
            description={getSchemaDescription(schemaName)}
          />
        </article>
      </DocsPageFrame>
    )
  }

  if (page.type === 'openapi') {
    // Same outer rails as guides (left nav + reserved right rail). Examples stay
    // in the operation layout's middle column so chrome widths match docs pages.
    return (
      <DocsPageFrame>
        <article className="fd-openapi min-w-0 w-full">
          {/* Title/section header is rendered inside OpenAPIPage's content column
              (see renderOperationLayout in components/api-page.tsx). */}
          <OpenAPIPage {...page.data.getOpenAPIPageProps()} />
        </article>
      </DocsPageFrame>
    )
  }

  const MDXContent = page.data.body
  const toc = page.data.toc

  return (
    <DocsPageFrame toc={toc}>
      <article className="w-full min-w-0 max-w-3xl">
        <header className="mb-8 pb-6 border-b border-border">
          <p className="text-sm text-[var(--accent)] font-medium mb-2">{sectionName}</p>
          <h1 className="text-3xl font-bold text-foreground">{page.data.title}</h1>
          {page.data.description && (
            <p className="mt-3 text-base text-muted-foreground">{page.data.description}</p>
          )}
        </header>
        <div className="prose prose-slate dark:prose-invert max-w-none min-w-0">
          <MDXContent components={getMDXComponents()} />
        </div>
      </article>
    </DocsPageFrame>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const page = source.getPage(slug)

  if (!page) return {}

  const section = getDocsSection(page.url)
  const tree = getTreeForSection(section)
  const sectionLabel = section === 'reference'
    ? findReferenceSectionName(tree, page.url)
    : findSectionName(tree, page.url)
  const title = page.data.title ?? siteConfig.name
  const description = page.data.description
  const fullTitle = `${title} · ${siteConfig.title}`

  const baseUrl = getSiteUrl()
  const ogImageUrl = new URL(`${baseUrl}/api/og`)
  ogImageUrl.searchParams.set('title', title)
  ogImageUrl.searchParams.set('section', sectionLabel)

  return {
    title,
    description,
    openGraph: {
      title: fullTitle,
      description,
      type: 'article',
      url: `${baseUrl}${page.url}`,
      images: [
        {
          url: ogImageUrl.toString(),
          width: 1200,
          height: 630,
          alt: fullTitle,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImageUrl.toString()],
    },
  }
}
