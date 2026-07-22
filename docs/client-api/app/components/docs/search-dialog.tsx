'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { docsAssetPath } from '@/lib/docs-paths';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type SearchEntry = {
  title: string;
  url: string;
  description: string;
};

export function SearchTrigger() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-lg w-full max-w-md',
          'bg-muted/50 border border-border/50',
          'text-sm text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border',
          'transition-all',
        )}
      >
        <SearchIcon className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">Search documentation...</span>
        <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded bg-background/80 text-xs font-mono text-muted-foreground/60 border border-border/40">
          <span>⌘</span>K
        </kbd>
      </button>

      {mounted && open && createPortal(
        <SearchDialog onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const resultsRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    fetch(docsAssetPath('/search-manifest.json'))
      .then((response) => response.json())
      .then((data: SearchEntry[]) => setEntries(data))
      .catch(() => setEntries([]));
  }, []);

  const results = entries.filter((entry) => {
    if (!search.trim()) return false;
    const haystack = `${entry.title} ${entry.description} ${entry.url}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, search]);

  const handleSelect = useCallback(
    (url: string) => {
      const href = url.startsWith('/docs/') || url === '/docs' ? url : `/docs${url.startsWith('/') ? '' : '/'}${url}`
      window.location.assign(href)
      onClose()
    },
    [onClose],
  )

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (results.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex].url);
        }
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [onClose, results, selectedIndex, handleSelect]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10%]">
      <div className="fixed inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-2xl mx-4" role="dialog" aria-modal="true">
        <div className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 border-b border-border">
            <SearchIcon className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              type="text"
              aria-label="Search documentation"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 py-4 bg-transparent text-foreground placeholder:text-muted-foreground text-base border-none outline-none"
              autoFocus
            />
            <kbd className="px-2 py-1 rounded bg-muted text-xs text-muted-foreground font-mono border border-border">
              ESC
            </kbd>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {search.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <p>Start typing to search...</p>
              </div>
            ) : results.length > 0 ? (
              <ul ref={resultsRef} className="py-2">
                {results.map((result, index) => (
                  <li key={`${result.url}-${result.title}`}>
                    <button
                      type="button"
                      onClick={() => handleSelect(result.url)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        'w-full px-4 py-3 text-left transition-colors',
                        selectedIndex === index
                          ? 'bg-gray-100 dark:bg-gray-800'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                      )}
                    >
                      <div className="font-semibold text-foreground">{result.title}</div>
                      {result.description ? (
                        <div className="text-sm text-muted-foreground mt-0.5">{result.description}</div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <p>No results found for &quot;{search}&quot;</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}
