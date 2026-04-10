/**
 * Playwright page.evaluate runs in the browser. This file is read at runtime and passed as a
 * string to page.evaluate(...) so tsx/esbuild never transform it (avoids ReferenceError: __name is not defined).
 *
 * Shape must match RawExtractedPage / WebsiteVerificationExtractedPage + same_origin_links.
 */
(function websiteVerificationExtractPage(depthValue) {
  function textOf(selector) {
    const el = document.querySelector(selector);
    const text = (el instanceof HTMLElement ? el.innerText : el && el.textContent) || '';
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  function metaContent() {
    const selectors = Array.prototype.slice.call(arguments);
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i]);
      const value = el && el.content ? String(el.content).trim() : '';
      if (value) return value;
    }
    return null;
  }
  const visibleRoot =
    document.querySelector('main') ||
    document.querySelector('article') ||
    document.body;
  const visibleText = (visibleRoot && visibleRoot.innerText ? visibleRoot.innerText : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000);
  const footerEl = document.querySelector('footer');
  const footerText = footerEl && footerEl.innerText
    ? footerEl.innerText.replace(/\s+/g, ' ').trim()
    : null;
  const footerCopyrightHit = Boolean(footerText && /copyright|all rights reserved|©/i.test(footerText));
  const anchors = Array.prototype.slice
    .call(document.querySelectorAll('a[href]'))
    .map(function (anchor) {
      const href = anchor.getAttribute('href') || '';
      const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
      try {
        return { href: new URL(href, document.baseURI).toString(), text: text };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
  const telNumbers = anchors
    .filter(function (item) {
      return item.href.indexOf('tel:') === 0;
    })
    .map(function (item) {
      return item.href.slice(4);
    });
  const mailtoDomains = anchors
    .filter(function (item) {
      return item.href.indexOf('mailto:') === 0;
    })
    .map(function (item) {
      const local = item.href.slice(7).split('?')[0];
      const at = local.split('@')[1];
      return at ? at.toLowerCase() : '';
    })
    .filter(Boolean);
  const sameOriginLinks = anchors
    .filter(function (item) {
      return item.href.indexOf('http://') === 0 || item.href.indexOf('https://') === 0;
    })
    .map(function (item) {
      return { href: item.href, text: item.text };
    });
  const socialLinks = anchors
    .map(function (item) {
      return item.href;
    })
    .filter(function (href) {
      return /(linkedin\.com\/company|facebook\.com\/|instagram\.com\/|x\.com\/|twitter\.com\/)/i.test(href);
    });
  const mapLinks = anchors
    .map(function (item) {
      return item.href;
    })
    .filter(function (href) {
      return /(google\.[^/]+\/maps|maps\.google\.com|g\.page|bbb\.org)/i.test(href);
    });
  const canonicalLink = document.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonicalLink && canonicalLink.href ? canonicalLink.href : null;

  function flattenJsonLd(value, out) {
    if (!out) out = [];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) flattenJsonLd(value[i], out);
      return out;
    }
    if (value && typeof value === 'object') {
      out.push(value);
      if (value['@graph']) flattenJsonLd(value['@graph'], out);
    }
    return out;
  }

  const jsonLdEntries = Array.prototype.slice
    .call(document.querySelectorAll('script[type="application/ld+json"]'))
    .flatMap(function (script) {
      const raw = (script.textContent && script.textContent.trim()) || '';
      if (!raw) return [];
      try {
        return flattenJsonLd(JSON.parse(raw), []);
      } catch (e) {
        return [];
      }
    });

  const jsonLdTypes = jsonLdEntries
    .flatMap(function (entry) {
      const type = entry['@type'];
      return Array.isArray(type) ? type : typeof type === 'string' ? [type] : [];
    })
    .map(function (value) {
      return String(value);
    });
  const jsonLdNames = jsonLdEntries
    .map(function (entry) {
      return typeof entry.name === 'string' ? entry.name : null;
    })
    .filter(Boolean);
  const jsonLdLegalNames = jsonLdEntries
    .map(function (entry) {
      return typeof entry.legalName === 'string' ? entry.legalName : null;
    })
    .filter(Boolean);
  const jsonLdPhones = jsonLdEntries
    .map(function (entry) {
      return typeof entry.telephone === 'string' ? entry.telephone : null;
    })
    .filter(Boolean);
  const jsonLdEmails = jsonLdEntries
    .map(function (entry) {
      return typeof entry.email === 'string' ? entry.email : null;
    })
    .filter(Boolean);
  const jsonLdAddresses = jsonLdEntries
    .map(function (entry) {
      const address = entry.address;
      if (!address || typeof address !== 'object') return null;
      const addr = address;
      return [
        addr.streetAddress,
        addr.addressLocality,
        addr.addressRegion,
        addr.postalCode,
        addr.addressCountry,
      ]
        .filter(function (value) {
          return typeof value === 'string' && value.trim().length > 0;
        })
        .join(', ');
    })
    .filter(Boolean);
  const sameAs = jsonLdEntries
    .flatMap(function (entry) {
      const value = entry.sameAs;
      return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    })
    .map(function (value) {
      return String(value);
    });
  const parentOrganizationNames = jsonLdEntries
    .map(function (entry) {
      const value = entry.parentOrganization;
      if (value && typeof value === 'object' && typeof value.name === 'string') {
        return String(value.name);
      }
      return null;
    })
    .filter(Boolean);

  return {
    url: window.location.href,
    depth: depthValue,
    final_url: window.location.href,
    title: document.title && document.title.trim() ? document.title.trim() : null,
    meta_description: metaContent('meta[name="description" i]'),
    og_title: metaContent('meta[property="og:title" i]'),
    og_site_name: metaContent('meta[property="og:site_name" i]'),
    twitter_title: metaContent('meta[name="twitter:title" i]'),
    h1: textOf('h1') || textOf('[role="heading"]') || textOf('main h2'),
    visible_text: visibleText,
    json_ld_types: Array.from(new Set(jsonLdTypes)),
    json_ld_names: Array.from(new Set(jsonLdNames)),
    json_ld_legal_names: Array.from(new Set(jsonLdLegalNames)),
    json_ld_phones: Array.from(new Set(jsonLdPhones)),
    json_ld_emails: Array.from(new Set(jsonLdEmails)),
    json_ld_addresses: Array.from(new Set(jsonLdAddresses)),
    same_as: Array.from(new Set(sameAs)),
    mailto_domains: Array.from(new Set(mailtoDomains)),
    tel_numbers: Array.from(new Set(telNumbers)),
    social_links: Array.from(new Set(socialLinks)),
    map_links: Array.from(new Set(mapLinks)),
    footer_text: footerText,
    footer_copyright_hit: footerCopyrightHit,
    parent_organization_names: Array.from(new Set(parentOrganizationNames)),
    canonical_url: canonicalUrl,
    parse_ok: true,
    same_origin_links: Array.from(new Set(sameOriginLinks)),
  };
})
