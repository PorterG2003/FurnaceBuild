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
        <div className="max-w-[90rem] mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
          {/* Fixed tracks so page content cannot widen the chrome. */}
          <div className="grid w-full gap-8 grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="hidden lg:block min-w-0">
              <DocsSectionSidebar docsTree={docsTree} referenceTree={referenceTree} />
            </div>
            <main className="min-w-0 w-full">
              {children}
            </main>
          </div>
        </div>
      </div>

      <footer className="border-t border-border py-8">
        <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8">
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
