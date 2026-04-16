'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface DashboardStats {
  totalAssets: number
  totalDatasets: number
  totalLengthKm: number
  totalCost: number
  byType: Record<string, number>
  byStatus: Record<string, number>
  recentDatasets: { id: number; name: string; feature_count: number; created_at: string }[]
}

const STATUS_COLORS: Record<string, string> = {
  active: '#059669',
  planned: '#d97706',
  decommissioned: '#64748b',
  maintenance: '#2563eb',
  unknown: '#94a3b8',
}

const TYPE_COLORS = ['#2563EB', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#6366f1']

function formatCurrency(value: number) {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const KPI_CARDS = [
  { label: 'Total Assets', href: '/assets', color: '#2563EB', icon: '📡' },
  { label: 'Total Datasets', href: '/upload', color: '#7c3aed', icon: '📂' },
  { label: 'Network Length', href: '/insights', color: '#059669', icon: '📏' },
  { label: 'Total Cost', href: '/insights', color: '#d97706', icon: '💰' },
] as const

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) setStats(data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="h-[calc(100vh-52px)] flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">Loading dashboard...</span>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="h-[calc(100vh-52px)] flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Failed to load dashboard data.</p>
      </div>
    )
  }

  const typeEntries = Object.entries(stats.byType).sort(([, a], [, b]) => b - a)
  const statusEntries = Object.entries(stats.byStatus).sort(([, a], [, b]) => b - a)
  const maxTypeCount = typeEntries.length > 0 ? Math.max(...typeEntries.map(([, v]) => v)) : 1
  const maxStatusCount = statusEntries.length > 0 ? Math.max(...statusEntries.map(([, v]) => v)) : 1

  const kpiValues = [
    stats.totalAssets.toLocaleString(),
    stats.totalDatasets.toLocaleString(),
    `${stats.totalLengthKm.toLocaleString('en-US', { maximumFractionDigits: 1 })} km`,
    formatCurrency(stats.totalCost),
  ]

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl p-6">
        {/* Welcome / Intro Section */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Welcome to Cably</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Your centralized telecom network intelligence platform. Upload KML/KMZ files, manage vendors, track costs, and visualize your fiber infrastructure.
          </p>
        </div>

        {/* Getting Started Banner (shown when no assets) */}
        {stats.totalAssets === 0 && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-600 text-white text-xs font-bold">i</span>
              Getting Started
            </h2>
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-blue-700">
              <li>Upload your network data (KML/KMZ/CSV)</li>
              <li>Add vendors in Vendor Management</li>
              <li>Link vendors to assets and set costs</li>
              <li>View your network on the interactive map</li>
            </ol>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-4 mb-6">
          {KPI_CARDS.map((c, i) => (
            <Link
              key={c.label}
              href={c.href}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all no-underline block"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{c.icon}</span>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{c.label}</p>
              </div>
              <p className="text-3xl font-bold font-mono" style={{ color: c.color }}>{kpiValues[i]}</p>
            </Link>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 lg:grid-cols-2 mb-6">
          {/* Assets by Type */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <span>🏷️</span> Assets by Type
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Distribution of network assets across infrastructure categories (e.g. fiber, conduit, splice point).
            </p>
            {typeEntries.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No data yet</p>
            ) : (
              <div className="space-y-3">
                {typeEntries.map(([type, count], i) => {
                  const pct = maxTypeCount > 0 ? (count / maxTypeCount) * 100 : 0
                  const color = TYPE_COLORS[i % TYPE_COLORS.length]
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-xs text-slate-600 font-medium w-36 truncate text-right shrink-0">{type}</span>
                      <div className="flex-1 h-6 bg-slate-100 rounded-md overflow-hidden">
                        <div
                          className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-2"
                          style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: color }}
                        >
                          <span className="text-[10px] font-bold text-white drop-shadow-sm">{count}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Assets by Status */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <span>📊</span> Assets by Status
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Current operational status of all assets -- active, planned, under maintenance, or decommissioned.
            </p>
            {statusEntries.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No data yet</p>
            ) : (
              <div className="space-y-3">
                {statusEntries.map(([status, count]) => {
                  const pct = maxStatusCount > 0 ? (count / maxStatusCount) * 100 : 0
                  const color = STATUS_COLORS[status] || STATUS_COLORS.unknown
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className="text-xs text-slate-600 font-medium w-36 truncate text-right shrink-0 capitalize">{status}</span>
                      <div className="flex-1 h-6 bg-slate-100 rounded-md overflow-hidden">
                        <div
                          className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-2"
                          style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: color }}
                        >
                          <span className="text-[10px] font-bold text-white drop-shadow-sm">{count}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent Uploads */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <span>📤</span> Recent Uploads
            </h2>
          </div>
          {stats.recentDatasets.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-400">No datasets uploaded yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Dataset Name</th>
                  <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Features</th>
                  <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
                  <th className="text-right px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.recentDatasets.map(ds => (
                  <tr key={ds.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">{ds.name}</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-600">{ds.feature_count}</td>
                    <td className="px-5 py-3 text-right text-slate-500">{formatDate(ds.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href="/"
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 no-underline hover:underline"
                      >
                        View on Map
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Quick Links */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <span>⚡</span> Quick Links
          </h2>
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              { href: '/', label: 'Map', desc: 'Visualize your network infrastructure on an interactive map', icon: '🗺️', color: 'bg-blue-50 text-blue-700 border-blue-200' },
              { href: '/upload', label: 'Upload', desc: 'Import KML, KMZ, GeoJSON, or CSV files', icon: '📤', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
              { href: '/vendors', label: 'Vendors', desc: 'Manage vendor relationships and costs', icon: '🏢', color: 'bg-violet-50 text-violet-700 border-violet-200' },
              { href: '/insights', label: 'Insights', desc: 'Analyze network distribution and trends', icon: '📊', color: 'bg-amber-50 text-amber-700 border-amber-200' },
            ].map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-xl border p-4 shadow-sm hover:shadow-md transition-all no-underline ${link.color}`}
              >
                <span className="text-2xl block mb-2">{link.icon}</span>
                <p className="text-sm font-semibold">{link.label}</p>
                <p className="text-xs opacity-70 mt-0.5">{link.desc}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Need Help Section */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <span>💡</span> Need help?
          </h2>
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-0.5 shrink-0">--</span>
              <span>Upload <strong>KML, KMZ, GeoJSON, or CSV</strong> files from the <Link href="/upload" className="text-blue-600 hover:underline">Upload</Link> page to get started.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-0.5 shrink-0">--</span>
              <span>Add and manage your vendors on the <Link href="/vendors" className="text-blue-600 hover:underline">Vendors</Link> page, then link them to assets for cost tracking.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-0.5 shrink-0">--</span>
              <span>Use the <Link href="/" className="text-blue-600 hover:underline">Map</Link> to visually explore your fiber routes, splice points, and other infrastructure.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-0.5 shrink-0">--</span>
              <span>Head to <Link href="/insights" className="text-blue-600 hover:underline">Insights</Link> for analytics on asset distribution, network length, and cost breakdowns.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
