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
  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
  function uniqueStrings(values, limit) {
    const out = [];
    const seen = {};
    for (let i = 0; i < values.length; i++) {
      const value = compactText(values[i]);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(value);
      if (limit && out.length >= limit) break;
    }
    return out;
  }
  function absoluteUrl(raw) {
    try {
      return new URL(raw || '', document.baseURI).toString();
    } catch (e) {
      return null;
    }
  }
  function isLikelyVisible(el) {
    if (!(el instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }
  const visibleRoot =
    document.querySelector('main') ||
    document.querySelector('article') ||
    document.body;
  function cloneWithoutBoilerplate(root) {
    if (!root || !root.cloneNode) return null;
    const clone = root.cloneNode(true);
    Array.prototype.slice
      .call(clone.querySelectorAll('script, style, noscript, svg, nav, header, footer, form, iframe, [aria-hidden="true"]'))
      .forEach(function (el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    return clone;
  }
  const cleanRoot = cloneWithoutBoilerplate(visibleRoot);
  const visibleText = compactText(visibleRoot && visibleRoot.innerText ? visibleRoot.innerText : '').slice(0, 50000);
  const mainText = compactText(cleanRoot && cleanRoot.textContent ? cleanRoot.textContent : visibleText).slice(0, 8000);
  const headings = uniqueStrings(
    Array.prototype.slice
      .call(document.querySelectorAll('main h1, main h2, main h3, article h1, article h2, article h3, h1, h2'))
      .filter(isLikelyVisible)
      .map(function (el) {
        return el.textContent || '';
      }),
    32,
  );
  const footerEl = document.querySelector('footer');
  const footerText = footerEl && footerEl.innerText
    ? compactText(footerEl.innerText)
    : null;
  const footerCopyrightHit = Boolean(footerText && /copyright|all rights reserved|©/i.test(footerText));
  const anchors = Array.prototype.slice
    .call(document.querySelectorAll('a[href]'))
    .map(function (anchor) {
      const href = anchor.getAttribute('href') || '';
      const text = compactText(anchor.textContent || '');
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
  const emailsFromText = (visibleText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
    .map(function (value) {
      return value.toLowerCase();
    });
  const canonicalLink = document.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonicalLink && canonicalLink.href ? canonicalLink.href : null;
  const faviconUrls = Array.prototype.slice
    .call(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]'))
    .map(function (el) {
      return absoluteUrl(el.getAttribute('href') || el.href || '');
    })
    .filter(Boolean);
  const images = Array.prototype.slice
    .call(document.querySelectorAll('main img, article img, header img, img'))
    .filter(isLikelyVisible)
    .map(function (img) {
      const src = absoluteUrl(img.currentSrc || img.src || img.getAttribute('src') || '');
      if (!src) return null;
      return {
        src: src,
        alt: compactText(img.getAttribute('alt') || '') || null,
        width: Number(img.naturalWidth || img.width || 0) || undefined,
        height: Number(img.naturalHeight || img.height || 0) || undefined,
      };
    })
    .filter(Boolean)
    .slice(0, 80);
  const logoImageCandidates = images
    .filter(function (img) {
      return /logo|brand|site-logo|navbar-brand/i.test([img.src, img.alt].filter(Boolean).join(' '));
    })
    .map(function (img) {
      return img.src;
    });
  const ogImage = metaContent('meta[property="og:image" i]', 'meta[name="twitter:image" i]');
  const heroImageCandidates = []
    .concat(ogImage ? [absoluteUrl(ogImage)].filter(Boolean) : [])
    .concat(
      images
        .filter(function (img) {
          if (!/^https:\/\//i.test(img.src)) return false;
          const width = Number(img.width || 0);
          const height = Number(img.height || 0);
          const alt = [img.alt || '', img.src].join(' ');
          if (/logo|icon|avatar|favicon|sprite/i.test(alt)) return false;
          return width >= 320 && height >= 180;
        })
        .sort(function (a, b) {
          return (Number(b.width || 0) * Number(b.height || 0)) - (Number(a.width || 0) * Number(a.height || 0));
        })
        .map(function (img) {
          return img.src;
        })
    )
    .filter(Boolean);
  const themeColor = metaContent('meta[name="theme-color" i]', 'meta[name="msapplication-TileColor" i]');
  const cssColorCounts = {};
  Array.prototype.slice.call(document.querySelectorAll('body, header, main, footer, a, button, h1, h2, h3')).forEach(function (el) {
    if (!(el instanceof HTMLElement)) return;
    const style = window.getComputedStyle(el);
    [style.color, style.backgroundColor, style.borderColor].forEach(function (color) {
      if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') return;
      cssColorCounts[color] = (cssColorCounts[color] || 0) + 1;
    });
  });
  const brandColorCandidates = Object.keys(cssColorCounts)
    .sort(function (a, b) {
      return cssColorCounts[b] - cssColorCounts[a];
    })
    .slice(0, 10)
    .map(function (color) {
      return { color: color, source: 'css', count: cssColorCounts[color] };
    });

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
  const jsonLdLogos = jsonLdEntries
    .flatMap(function (entry) {
      const logo = entry.logo;
      if (typeof logo === 'string') return [logo];
      if (logo && typeof logo === 'object' && typeof logo.url === 'string') return [logo.url];
      if (logo && typeof logo === 'object' && typeof logo.contentUrl === 'string') return [logo.contentUrl];
      return [];
    })
    .map(absoluteUrl)
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
    headings: headings,
    visible_text: visibleText,
    main_text: mainText,
    text_char_count: mainText.length,
    json_ld_types: Array.from(new Set(jsonLdTypes)),
    json_ld: jsonLdEntries.slice(0, 25),
    json_ld_names: Array.from(new Set(jsonLdNames)),
    json_ld_legal_names: Array.from(new Set(jsonLdLegalNames)),
    json_ld_phones: Array.from(new Set(jsonLdPhones)),
    json_ld_emails: Array.from(new Set(jsonLdEmails)),
    json_ld_addresses: Array.from(new Set(jsonLdAddresses)),
    emails: Array.from(new Set(emailsFromText.concat(jsonLdEmails))),
    same_as: Array.from(new Set(sameAs)),
    mailto_domains: Array.from(new Set(mailtoDomains)),
    tel_numbers: Array.from(new Set(telNumbers)),
    social_links: Array.from(new Set(socialLinks)),
    map_links: Array.from(new Set(mapLinks)),
    images: images,
    favicon_urls: Array.from(new Set(faviconUrls)),
    logo_candidates: Array.from(new Set(jsonLdLogos.concat(logoImageCandidates).concat(ogImage ? [absoluteUrl(ogImage)].filter(Boolean) : []))),
    hero_image_candidates: Array.from(new Set(heroImageCandidates)).slice(0, 5),
    theme_color: themeColor,
    brand_color_candidates: brandColorCandidates,
    footer_text: footerText,
    footer_copyright_hit: footerCopyrightHit,
    parent_organization_names: Array.from(new Set(parentOrganizationNames)),
    canonical_url: canonicalUrl,
    parse_ok: true,
    same_origin_links: Array.from(new Set(sameOriginLinks)),
  };
})
