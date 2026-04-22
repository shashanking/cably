'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/map', label: 'Map', icon: '🗺️' },
  { href: '/assets', label: 'Assets', icon: '📋' },
  { href: '/assets/fill', label: 'Fill', icon: '✏️' },
  { href: '/upload', label: 'Upload', icon: '📤' },
  { href: '/insights', label: 'Insights', icon: '📈' },
  { href: '/vendors', label: 'Vendors', icon: '🏢' },
]

export default function HeaderBar() {
  const pathname = usePathname()

  return (
    <header className="h-[52px] bg-white border-b border-slate-200 flex items-center px-4 gap-4 relative z-[1000] shrink-0 shadow-sm">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center shadow-sm">
          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
        </div>
        <div>
          <span className="text-[15px] font-bold text-slate-900 tracking-tight">Cably</span>
          <span className="hidden sm:inline text-[10px] text-slate-400 ml-2 font-medium uppercase tracking-wider">Telecom GIS</span>
        </div>
      </div>

      <div className="w-px h-6 bg-slate-200" />

      {/* Nav */}
      <nav className="flex items-center gap-1">
        {navItems.map(item => {
          const active = pathname === item.href
          return (
            <Link key={item.href} href={item.href}
              className={`px-3 py-1.5 text-[13px] font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span className="text-sm">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex-1" />

      {/* Status */}
      <div className="hidden md:flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Connected
      </div>

      <a href="/api/export-kml"
        className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer text-xs font-medium flex items-center gap-1.5 transition-all hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 no-underline shadow-sm"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Export
      </a>
    </header>
  )
}
