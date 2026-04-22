import type { Metadata } from 'next'
import Script from 'next/script'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import AppShell from '../components/AppShell'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Cably — Telecom GIS Platform',
  description: 'Fiber network mapping and intelligence platform for telecom GIS analytics.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* ArcGIS Maps SDK — loaded from Esri's CDN so the ~1,500-module
            package never hits Next/Turbopack bundling. Dojo AMD loader
            exposes window.require() which ArcGISMap.tsx uses. */}
        <link rel="stylesheet" href="https://js.arcgis.com/4.32/esri/themes/light/main.css" />
        <Script src="https://js.arcgis.com/4.32/" strategy="beforeInteractive" />
      </head>
      <body className="min-h-full bg-[var(--bg)] text-[var(--tx)]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
