import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import HeaderBar from '../components/HeaderBar'

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
      <body className="min-h-full bg-[var(--bg)] text-[var(--tx)]">
        <div className="min-h-screen flex flex-col">
          <HeaderBar />
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </body>
    </html>
  )
}
