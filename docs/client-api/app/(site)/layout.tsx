import { docsTree, referenceTree } from '@/lib/docs-source'
import { DocsHeader } from '../components/docs/docs-header'
import { DocsSectionSidebar } from '../components/docs/docs-section-sidebar'
import { siteConfig } from '@/lib/theme-config'

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <DocsHeader docsTree={docsTree} referenceTree={referenceTree} />

      <div className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex gap-8">
            <DocsSectionSidebar docsTree={docsTree} referenceTree={referenceTree} />
            <main className="flex-1 min-w-0">
              {children}
            </main>
          </div>
        </div>
      </div>

      <footer className="border-t border-border py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              {siteConfig.footer.copyright}
            </p>
            <div className="flex items-center gap-4">
              {siteConfig.footer.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </a>
              ))}
              <span className="text-muted-foreground/50">|</span>
              <span className="text-xs text-muted-foreground/70">For AI:</span>
              <a
                href="/llms.txt"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
              >
                llms.txt
              </a>
              <a
                href="/llms-full.txt"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
              >
                llms-full.txt
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
