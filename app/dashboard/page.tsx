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
  active: '#10b981',
  planned: '#f59e0b',
  decommissioned: '#64748b',
  maintenance: '#3b82f6',
  unknown: '#94a3b8',
}

const TYPE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#6366f1']

function formatCompact(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelative(dateStr: string) {
  const d = new Date(dateStr).getTime()
  const diff = Date.now() - d
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function Icon({ path, className = 'w-4 h-4' }: { path: string; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: path }} />
}

const ICONS = {
  assets: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  dataset: '<path d="M3 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  length: '<path d="M3 6h18M3 18h18M7 6v12M17 6v12"/>',
  cost: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  map: '<path d="M9 3l-6 3v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  vendors: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
  insights: '<path d="M3 3v18h18M7 14l4-4 4 4 5-5"/>',
  chip: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
  pulse: '<path d="M3 12h4l3-9 4 18 3-9h4"/>',
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => r.json())
      .then(data => { if (data && !data.error) setStats(data) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="h-[calc(100vh-52px)] bg-[#0b1220] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-blue-200/70 font-mono">Loading control center…</span>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="h-[calc(100vh-52px)] bg-[#0b1220] flex items-center justify-center">
        <p className="text-sm text-slate-400">Failed to load dashboard data.</p>
      </div>
    )
  }

  const typeEntries = Object.entries(stats.byType).sort(([, a], [, b]) => b - a)
  const statusEntries = Object.entries(stats.byStatus).sort(([, a], [, b]) => b - a)
  const maxTypeCount = typeEntries.length > 0 ? Math.max(...typeEntries.map(([, v]) => v)) : 1
  const maxStatusCount = statusEntries.length > 0 ? Math.max(...statusEntries.map(([, v]) => v)) : 1

  const kpis = [
    { label: 'Total Assets', value: stats.totalAssets.toLocaleString(), sub: `${typeEntries.length} types`, icon: ICONS.assets, href: '/assets', trend: 'up', accent: 'from-blue-500 to-cyan-400' },
    { label: 'Datasets', value: stats.totalDatasets.toLocaleString(), sub: 'ingested files', icon: ICONS.dataset, href: '/upload', trend: 'flat', accent: 'from-violet-500 to-fuchsia-400' },
    { label: 'Network Length', value: `${formatCompact(stats.totalLengthKm)} km`, sub: 'route mileage', icon: ICONS.length, href: '/insights', trend: 'up', accent: 'from-emerald-500 to-teal-400' },
    { label: 'Capex Tracked', value: `$${formatCompact(stats.totalCost)}`, sub: 'aggregated cost', icon: ICONS.cost, href: '/insights', trend: 'up', accent: 'from-amber-500 to-orange-400' },
  ]

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-[#0b1220] text-slate-100">
      {/* Grid background */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(rgba(96,165,250,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,.6) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      <div className="relative mx-auto max-w-7xl px-6 py-6">
        {/* Title strip */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-[0.25em] text-blue-300/60 uppercase">Mission Control</span>
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono text-emerald-300/80">LIVE</span>
            </div>
            <h1 className="text-2xl font-semibold text-white tracking-tight">Network Command</h1>
            <p className="text-sm text-slate-400 mt-0.5">Real-time telemetry across your fiber, transport, and site infrastructure.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/upload" className="h-9 px-4 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-sm font-medium text-slate-200 flex items-center gap-2 transition-colors">
              <Icon path={ICONS.upload} className="w-4 h-4" />Ingest
            </Link>
            <Link href="/" className="h-9 px-4 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-white text-sm font-semibold flex items-center gap-2 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all">
              <Icon path={ICONS.map} className="w-4 h-4" />Open Map
            </Link>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {kpis.map(k => (
            <Link key={k.label} href={k.href} className="group relative rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] hover:border-white/20 transition-all overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${k.accent} opacity-60 group-hover:opacity-100 transition-opacity`} />
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${k.accent} bg-opacity-20 flex items-center justify-center text-white shadow-md`}>
                  <Icon path={k.icon} className="w-4 h-4" />
                </div>
                <div className="text-[9px] font-mono tracking-wider text-slate-500 uppercase">{k.trend === 'up' ? '↗︎ 24h' : '— 24h'}</div>
              </div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase mb-1">{k.label}</div>
              <div className="text-2xl font-semibold text-white font-mono tracking-tight tabular-nums">{k.value}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{k.sub}</div>
            </Link>
          ))}
        </div>

        {/* Getting started banner (only when empty) */}
        {stats.totalAssets === 0 && (
          <div className="mb-6 rounded-xl border border-blue-400/20 bg-blue-500/5 p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-300 shrink-0">
                <Icon path={ICONS.upload} className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-blue-100 mb-1">No telemetry yet</h2>
                <p className="text-xs text-blue-200/70 mb-3">Ingest a KML/KMZ/GeoJSON/CSV to begin. Everything below populates automatically.</p>
                <div className="flex gap-2">
                  <Link href="/upload" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-500 text-white text-xs font-semibold hover:bg-blue-400 transition-colors">Upload data</Link>
                  <Link href="/vendors" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-white/10 text-xs font-medium text-slate-300 hover:bg-white/5">Add vendors</Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Charts Row */}
        <div className="grid gap-3 lg:grid-cols-2 mb-6">
          <Panel title="Asset Composition" sub="By infrastructure type" icon={ICONS.chip} accent="#3b82f6">
            {typeEntries.length === 0 ? (
              <EmptyChart label="No type data" />
            ) : (
              <div className="space-y-2.5">
                {typeEntries.slice(0, 8).map(([type, count], i) => {
                  const pct = maxTypeCount > 0 ? (count / maxTypeCount) * 100 : 0
                  const color = TYPE_COLORS[i % TYPE_COLORS.length]
                  const share = stats.totalAssets > 0 ? ((count / stats.totalAssets) * 100).toFixed(1) : '0'
                  return (
                    <div key={type} className="group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                          <span className="text-xs text-slate-300 truncate font-medium">{type}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-mono text-slate-500">{share}%</span>
                          <span className="text-xs font-mono text-white font-semibold w-12 text-right tabular-nums">{count.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel title="Operational Status" sub="Lifecycle distribution" icon={ICONS.pulse} accent="#10b981">
            {statusEntries.length === 0 ? (
              <EmptyChart label="No status data" />
            ) : (
              <div className="space-y-2.5">
                {statusEntries.map(([status, count]) => {
                  const pct = maxStatusCount > 0 ? (count / maxStatusCount) * 100 : 0
                  const color = STATUS_COLORS[status] || STATUS_COLORS.unknown
                  const share = stats.totalAssets > 0 ? ((count / stats.totalAssets) * 100).toFixed(1) : '0'
                  return (
                    <div key={status}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}80` }} />
                          <span className="text-xs text-slate-300 font-medium capitalize">{status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-slate-500">{share}%</span>
                          <span className="text-xs font-mono text-white font-semibold w-12 text-right tabular-nums">{count.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* Recent uploads & quick links */}
        <div className="grid gap-3 lg:grid-cols-3 mb-6">
          <div className="lg:col-span-2">
            <Panel title="Recent Ingests" sub="Last 5 datasets" icon={ICONS.dataset} accent="#8b5cf6">
              {stats.recentDatasets.length === 0 ? (
                <EmptyChart label="Nothing ingested yet" />
              ) : (
                <div className="divide-y divide-white/5 -mx-4 -mb-2">
                  {stats.recentDatasets.map(ds => (
                    <div key={ds.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-8 h-8 rounded-md bg-violet-500/10 border border-violet-400/20 flex items-center justify-center text-violet-300 shrink-0">
                        <Icon path={ICONS.dataset} className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate">{ds.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{formatDate(ds.created_at)} · {formatRelative(ds.created_at)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-mono font-semibold text-white tabular-nums">{ds.feature_count.toLocaleString()}</div>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">features</div>
                      </div>
                      <Link href="/" className="ml-2 text-[11px] font-semibold text-blue-400 hover:text-blue-300 shrink-0">Open →</Link>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Quick Routes" sub="Jump to modules" icon={ICONS.pulse} accent="#f59e0b">
            <div className="space-y-2">
              {[
                { href: '/', label: 'Map Explorer', desc: 'Visualize fiber routes', icon: ICONS.map },
                { href: '/assets', label: 'Asset Registry', desc: 'Edit, vendor, cost', icon: ICONS.assets },
                { href: '/vendors', label: 'Vendor Hub', desc: 'Suppliers & contracts', icon: ICONS.vendors },
                { href: '/insights', label: 'Insights', desc: 'Capex & health', icon: ICONS.insights },
              ].map(l => (
                <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] px-3 py-2.5 transition-colors">
                  <div className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center text-slate-300 shrink-0">
                    <Icon path={l.icon} className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white">{l.label}</div>
                    <div className="text-[10px] text-slate-500">{l.desc}</div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </Link>
              ))}
            </div>
          </Panel>
        </div>

        {/* Footer */}
        <div className="text-[10px] text-slate-600 font-mono text-center py-2">
          Cably Telecom GIS · Build {new Date().getFullYear()} · {stats.totalAssets.toLocaleString()} features indexed
        </div>
      </div>
    </div>
  )
}

function Panel({ title, sub, icon, accent, children }: { title: string; sub?: string; icon: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[1.5px] opacity-60" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center" style={{ color: accent }}>
          <Icon path={icon} className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          {sub && <div className="text-[10px] text-slate-500 tracking-wider uppercase">{sub}</div>}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return <div className="py-6 text-center text-xs text-slate-500">{label}</div>
}
