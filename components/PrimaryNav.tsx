'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/', label: 'Map' },
  { href: '/assets', label: 'Assets' },
  { href: '/upload', label: 'Upload' },
  { href: '/insights', label: 'Insights' },
]

export default function PrimaryNav() {
  const pathname = usePathname()

  return (
    <nav className="hidden lg:flex items-center gap-0.5">
      {navItems.map(item => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              active
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
