interface DocsPagerProps {
  previous?: { name: string; url: string }
  next?: { name: string; url: string }
}

function navHref(url: string): string {
  if (url.startsWith('/docs/') || url === '/docs') return url
  return `/docs${url.startsWith('/') ? '' : '/'}${url}`
}

export function DocsPager({ previous, next }: DocsPagerProps) {
  if (!previous && !next) return null

  return (
    <nav className="flex justify-between mt-16 pt-8 border-t border-border">
      {previous ? (
        <a
          href={navHref(previous.url)}
          className="group flex flex-col gap-1 max-w-[45%]"
        >
          <span className="text-sm text-muted-foreground">Previous</span>
          <span className="text-foreground font-medium group-hover:text-[var(--accent)] transition-colors">
            ← {previous.name}
          </span>
        </a>
      ) : (
        <div />
      )}
      {next ? (
        <a
          href={navHref(next.url)}
          className="group flex flex-col gap-1 items-end text-right max-w-[45%]"
        >
          <span className="text-sm text-muted-foreground">Next</span>
          <span className="text-foreground font-medium group-hover:text-[var(--accent)] transition-colors">
            {next.name} →
          </span>
        </a>
      ) : (
        <div />
      )}
    </nav>
  )
}
