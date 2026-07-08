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

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.productName} ${siteConfig.name}`,
    template: `%s | ${siteConfig.productName} ${siteConfig.name}`,
  },
  description: siteConfig.description,
  icons: {
    icon: [{ url: docsAssetPath('/favicon.svg'), type: 'image/svg+xml' }],
    shortcut: docsAssetPath('/favicon.svg'),
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
