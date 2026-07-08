import { docsAssetPath } from './docs-paths';

/**
 * Furnace Client API docs theme.
 */

export const furnaceBrand = {
  orange: '#f14607',
  orangeBright: '#ff6b35',
  orangeDeep: '#c73800',
  bg: '#121212',
  bgNav: '#0d0d0d',
  bgPanel: '#1a1a1a',
  border: '#2a2a2a',
  text: '#e8e8e8',
  textMuted: '#a3a3a3',
} as const;

export const siteConfig = {
  name: 'Client API',
  productName: 'Furnace',
  description: 'Account-scoped REST API for campaigns, leads, inbox, and more.',
  url: 'https://api.getfurnace.io/docs',

  logo: {
    // Synced from public/Logo_Color.svg via export:client-api-docs
    src: docsAssetPath('/logo.svg'),
    markSrc: docsAssetPath('/logo-mark.svg'),
    alt: 'Furnace',
    width: 158,
    height: 40,
    markWidth: 28,
    markHeight: 28,
  },

  links: {
    github: '',
    discord: '',
    twitter: '',
    support: 'https://getfurnace.io',
  },

  footer: {
    copyright: '© Furnace. All rights reserved.',
    links: [{ label: 'getfurnace.io', href: 'https://getfurnace.io' }],
  },
};

export const themeConfig = {
  colors: {
    light: {
      accent: furnaceBrand.orange,
      accentForeground: '#ffffff',
      accentMuted: 'rgba(241, 70, 7, 0.12)',
    },
    dark: {
      accent: furnaceBrand.orangeBright,
      accentForeground: furnaceBrand.bg,
      accentMuted: 'rgba(255, 107, 53, 0.14)',
    },
  },

  codeBlock: {
    light: {
      background: '#fafafa',
      titleBar: '#f3f4f6',
    },
    dark: {
      background: furnaceBrand.bgPanel,
      titleBar: '#141414',
    },
  },

  ogImage: {
    gradient: `linear-gradient(135deg, ${furnaceBrand.bg} 0%, #2a1214 50%, ${furnaceBrand.orange} 100%)`,
    titleColor: '#ffffff',
    sectionColor: furnaceBrand.orangeBright,
    logoUrl: 'https://api.getfurnace.io/docs/logo-mark.svg',
  },
};

export function getCSSVariables(mode: 'light' | 'dark') {
  const colors = themeConfig.colors[mode];
  return {
    '--accent': colors.accent,
    '--accent-foreground': colors.accentForeground,
    '--accent-muted': colors.accentMuted,
  };
}

export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  return siteConfig.url;
}
