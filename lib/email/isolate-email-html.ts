/**
 * Isolate inbound email HTML so <style> tags cannot restyle the app.
 *
 * Inbox rendering uses dangerouslySetInnerHTML on web. Outlook / Proofpoint
 * messages often include document-level resets such as:
 *   div { margin: 0 !important; padding: 16px !important }
 * Those selectors apply to every div in the page unless they are dropped or
 * scoped to the message container.
 */

import { extractBodyFragmentFromHtml } from './emailHtmlMode.js';

export const EMAIL_HTML_SCOPE_SELECTOR = '.message-body-html';

const STYLE_TAG_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const SCOPABLE_AT_RULES = new Set(['@media', '@supports', '@container', '@layer']);

function stripCssWrappers(css: string): string {
  return css
    .replace(/<!--/g, '')
    .replace(/-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
}

function extractBraceBlock(css: string, openBraceIndex: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = openBraceIndex; i < css.length; i += 1) {
    const char = css[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { inner: css.slice(openBraceIndex + 1, i), end: i + 1 };
      }
    }
  }
  return { inner: css.slice(openBraceIndex + 1), end: css.length };
}

/**
 * Keep rules that target a class, id, or attribute so email-specific styling
 * survives. Drop type-only / universal document resets (`div`, `p`, `*`, …).
 */
export function selectorNeedsAppIsolation(selector: string): boolean {
  return /[.#[]/.test(selector);
}

export function scopeEmailSelector(selector: string, scope = EMAIL_HTML_SCOPE_SELECTOR): string {
  const trimmed = selector.trim();
  if (!trimmed) return '';

  const withoutDocumentRoots = trimmed
    .replace(/(^|[\s>+~,(])(?:html|body|:root)(?=[\s>+~.,:#[]|$)/gi, '$1')
    .replace(/^[\s>+~]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const target = withoutDocumentRoots || scope;
  if (target === scope || target.startsWith(`${scope} `) || target.startsWith(`${scope}.`) || target.startsWith(`${scope}#`) || target.startsWith(`${scope}:`) || target.startsWith(`${scope}[`)) {
    return target;
  }
  return `${scope} ${target}`;
}

export function isolateEmailCss(css: string, scope = EMAIL_HTML_SCOPE_SELECTOR): string {
  const source = stripCssWrappers(css);
  if (!source) return '';

  let output = '';
  let i = 0;

  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i] ?? '')) {
      i += 1;
    }
    if (i >= source.length) break;

    const nextBrace = source.indexOf('{', i);
    const nextSemi = source.indexOf(';', i);
    if (nextBrace === -1) break;

    const prelude = source.slice(i, nextBrace).trim();
    if (!prelude) {
      i = nextBrace + 1;
      continue;
    }

    if (prelude.startsWith('@')) {
      const atName = prelude.split(/[\s({]/, 1)[0]?.toLowerCase() ?? '';
      if (atName === '@import') {
        i = nextSemi !== -1 && (nextSemi < nextBrace || nextBrace === -1) ? nextSemi + 1 : nextBrace + 1;
        continue;
      }

      const { inner, end } = extractBraceBlock(source, nextBrace);
      if (SCOPABLE_AT_RULES.has(atName)) {
        const scopedInner = isolateEmailCss(inner, scope);
        if (scopedInner.trim()) {
          output += `${prelude}{${scopedInner}}`;
        }
      }
      i = end;
      continue;
    }

    const { inner, end } = extractBraceBlock(source, nextBrace);
    const scopedSelectors = prelude
      .split(',')
      .map((part) => part.trim())
      .filter(selectorNeedsAppIsolation)
      .map((part) => scopeEmailSelector(part, scope))
      .filter(Boolean);

    if (scopedSelectors.length > 0 && inner.trim()) {
      output += `${scopedSelectors.join(',')}{${inner}}`;
    }
    i = end;
  }

  return output.trim();
}

export function isolateEmailHtmlForRender(html: string | null | undefined): string {
  const raw = String(html ?? '').trim();
  if (!raw) return '';

  const scopedStyles: string[] = [];
  const withoutStyleTags = raw.replace(STYLE_TAG_PATTERN, (_match, css: string) => {
    const isolated = isolateEmailCss(css);
    if (isolated) scopedStyles.push(isolated);
    return '';
  });

  const fragment = extractBodyFragmentFromHtml(withoutStyleTags);
  const styleBlock = scopedStyles.length > 0 ? `<style>${scopedStyles.join('\n')}</style>` : '';
  return `${styleBlock}${fragment}`;
}
