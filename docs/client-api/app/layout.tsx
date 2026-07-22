import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from './providers/theme-provider'
import { siteConfig } from '@/lib/theme-config'
import { docsAssetPath } from '@/lib/docs-paths'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

// Same icon set as the main app (`public/index.html`). Paths must include /docs —
// Next does not apply basePath to metadata icon URLs.
export const metadata: Metadata = {
  metadataBase: new URL('https://api.getfurnace.io'),
  title: {
    default: siteConfig.title,
    template: `%s · ${siteConfig.title}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.title,
  icons: {
    icon: [
      { url: docsAssetPath('/favicon-96x96.png'), type: 'image/png', sizes: '96x96' },
      { url: docsAssetPath('/favicon.svg'), type: 'image/svg+xml' },
    ],
    shortcut: docsAssetPath('/favicon.ico'),
    apple: docsAssetPath('/apple-touch-icon.png'),
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
