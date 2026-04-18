'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getOwnerValue } from '../../lib/styling'

interface Asset { id: number; type: string; geometry: any; properties: any; total_cost?: number; cost_per_km?: number; length_km?: number; vendor_id?: number; status?: string }
interface Dataset { id: number; name: string; source_file: string | null; feature_count: number }
interface CostSummary { totalCost: number; totalLengthKm: number; avgCostPerKm: number; costByVendor: { vendor: string; cost: number; length: number }[]; costByStatus: { status: string; cost: number; count: number }[] }

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#6366f1', '#ec4899', '#84cc16']

function formatCompact(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function Icon({ path, className = 'w-4 h-4' }: { path: string; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: path }} />
}

const ICONS = {
  chip: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
  geometry: '<path d="M3 3l18 6-9 3zM3 3v18l9-6-9-3z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0116 0v1"/>',
  pulse: '<path d="M3 12h4l3-9 4 18 3-9h4"/>',
  cost: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  trend: '<path d="M3 3v18h18M7 14l4-4 4 4 5-5"/>',
  assets: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  length: '<path d="M3 6h18M3 18h18M7 6v12M17 6v12"/>',
  vendors: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11"/>',
}

export default function InsightsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState<number | null>(null)
  const [costData, setCostData] = useState<CostSummary | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/datasets').then(r => r.json()).catch(() => []),
      fetch('/api/costs/summary').then(r => r.json()).catch(() => null),
    ]).then(([d, c]) => {
      if (Array.isArray(d)) setDatasets(d)
      if (c && !c.error) setCostData(c)
    })
  }, [])

  useEffect(() => {
    fetch(datasetId ? `/api/assets?dataset_id=${datasetId}` : '/api/assets').then(r => r.json()).then(d => { if (Array.isArray(d)) setAssets(d) }).catch(console.error)
  }, [datasetId])

  const metrics = useMemo(() => {
    const byType: Record<string, number> = {}, byGeometry: Record<string, number> = {}, byOwner: Record<string, number> = {}, byStatus: Record<string, number> = {}
    assets.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + 1
      byGeometry[a.geometry?.type || 'Unknown'] = (byGeometry[a.geometry?.type || 'Unknown'] || 0) + 1
      const owner = getOwnerValue(a.properties) || 'Unattributed'; byOwner[owner] = (byOwner[owner] || 0) + 1
      const status = a.status || a.properties?.Status || a.properties?.construction_status || 'Unknown'; byStatus[status] = (byStatus[status] || 0) + 1
    })
    return { total: assets.length, byType, byGeometry, byOwner, byStatus }
  }, [assets])

  const kpis = [
    { label: 'Assets', value: metrics.total.toLocaleString(), sub: 'in filter', icon: ICONS.assets, accent: 'from-blue-500 to-cyan-400' },
    { label: 'Route length', value: costData ? `${formatCompact(costData.totalLengthKm)} km` : '—', sub: 'linear distance', icon: ICONS.length, accent: 'from-emerald-500 to-teal-400' },
    { label: 'Capex total', value: costData ? `$${formatCompact(costData.totalCost)}` : '—', sub: 'aggregated', icon: ICONS.cost, accent: 'from-amber-500 to-orange-400' },
    { label: 'Avg $/km', value: costData ? `$${formatCompact(costData.avgCostPerKm)}` : '—', sub: 'per route km', icon: ICONS.trend, accent: 'from-violet-500 to-fuchsia-400' },
  ]

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-[#0b1220] text-slate-100">
      <div className="fixed inset-0 pointer-events-none opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(rgba(96,165,250,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,.6) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      <div className="relative mx-auto max-w-7xl px-6 py-6">
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-[0.25em] text-blue-300/60 uppercase">Analytics Suite</span>
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <h1 className="text-2xl font-semibold text-white tracking-tight">Network Insights</h1>
            <p className="text-sm text-slate-400 mt-0.5">Capex, topology, ownership and lifecycle distribution across your footprint.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-400">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l9-4 9 4" /></svg>
              Dataset
            </div>
            <select value={datasetId ?? ''} onChange={e => setDatasetId(e.target.value === '' ? null : Number(e.target.value))} className="h-8 rounded-md border border-white/10 bg-[#111c2e] px-3 text-xs text-slate-200 font-medium focus:outline-none focus:border-blue-400">
              <option value="">All datasets</option>
              {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.feature_count})</option>)}
            </select>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {kpis.map(k => (
            <div key={k.label} className="relative rounded-xl border border-white/10 bg-white/[0.03] p-4 overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${k.accent} opacity-60`} />
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${k.accent} flex items-center justify-center text-white shadow-md`}>
                  <Icon path={k.icon} className="w-4 h-4" />
                </div>
              </div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase mb-1">{k.label}</div>
              <div className="text-2xl font-semibold text-white font-mono tracking-tight tabular-nums">{k.value}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Distribution charts */}
        <div className="grid gap-3 lg:grid-cols-2 mb-6">
          <DistChart title="By Type" sub="Infrastructure category" icon={ICONS.chip} accent="#3b82f6" data={metrics.byType} total={metrics.total} />
          <DistChart title="By Geometry" sub="Lines / points / polygons" icon={ICONS.geometry} accent="#10b981" data={metrics.byGeometry} total={metrics.total} />
          <DistChart title="By Owner" sub="Ownership and operator split" icon={ICONS.user} accent="#8b5cf6" data={metrics.byOwner} total={metrics.total} />
          <DistChart title="By Status" sub="Lifecycle state" icon={ICONS.pulse} accent="#f59e0b" data={metrics.byStatus} total={metrics.total} />

          {costData && costData.costByVendor.length > 0 && (
            <Panel title="Capex by Vendor" sub="Dollars allocated per supplier" icon={ICONS.vendors} accent="#10b981">
              <div className="space-y-2.5">
                {costData.costByVendor.slice(0, 10).map((v, i) => {
                  const max = costData.costByVendor[0]?.cost || 1
                  const color = COLORS[i % COLORS.length]
                  return (
                    <div key={v.vendor}>
                      <div className="flex items-center justify-between mb-1">
                        <Link href="/vendors" className="text-xs text-slate-300 font-medium hover:text-white flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm" style={{ background: color }} />{v.vendor}
                        </Link>
                        <span className="text-xs font-mono text-white font-semibold tabular-nums">${formatCompact(v.cost)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(v.cost / max) * 100}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}

          {costData && costData.costByStatus.length > 0 && (
            <Panel title="Capex by Status" sub="Investment across lifecycle" icon={ICONS.trend} accent="#f59e0b">
              <div className="space-y-2.5">
                {costData.costByStatus.map((s, i) => {
                  const max = costData.costByStatus[0]?.cost || 1
                  const statusColors: Record<string, string> = { active: '#10b981', planned: '#f59e0b', decommissioned: '#64748b', maintenance: '#3b82f6' }
                  const color = statusColors[s.status] || COLORS[i % COLORS.length]
                  return (
                    <div key={s.status}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}80` }} />
                          <span className="text-slate-300 font-medium capitalize">{s.status}</span>
                          <span className="text-slate-500 font-mono text-[10px]">{s.count} assets</span>
                        </div>
                        <span className="text-xs font-mono text-white font-semibold tabular-nums">${formatCompact(s.cost)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(s.cost / max) * 100}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2">
          <div>Need more context? Cross-reference with the map or drill into an asset.</div>
          <div className="flex gap-3">
            <Link href="/" className="text-blue-400 hover:text-blue-300 font-medium">Open Map →</Link>
            <Link href="/assets" className="text-blue-400 hover:text-blue-300 font-medium">Asset Registry →</Link>
            <Link href="/vendors" className="text-blue-400 hover:text-blue-300 font-medium">Vendor Hub →</Link>
          </div>
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

function DistChart({ title, sub, icon, accent, data, total }: { title: string; sub: string; icon: string; accent: string; data: Record<string, number>; total: number }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a)
  return (
    <Panel title={title} sub={sub} icon={icon} accent={accent}>
      {entries.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500">No data. <Link href="/upload" className="text-blue-400 underline">Ingest data</Link> to populate.</div>
      ) : (
        <div className="space-y-2.5">
          {entries.slice(0, 12).map(([type, count], i) => {
            const pct = total > 0 ? (count / total) * 100 : 0
            const color = COLORS[i % COLORS.length]
            return (
              <div key={type}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                    <span className="text-xs text-slate-300 font-medium truncate" title={type}>{type}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-slate-500">{pct.toFixed(0)}%</span>
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
  )
}
