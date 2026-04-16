'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface Asset { id: number; type: string; geometry: any; properties: any; total_cost?: number; cost_per_km?: number; length_km?: number; vendor_id?: number; status?: string }
interface Dataset { id: number; name: string; source_file: string | null; feature_count: number }
interface CostSummary { totalCost: number; totalLengthKm: number; avgCostPerKm: number; costByVendor: { vendor: string; cost: number; length: number }[]; costByStatus: { status: string; cost: number; count: number }[] }

const COLORS = ['#2563EB', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#6366f1', '#be185d', '#65a30d']

export default function InsightsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState<number | null>(null)
  const [costData, setCostData] = useState<CostSummary | null>(null)

  useEffect(() => {
    fetch('/api/datasets').then(r => r.json()).then(d => { if (Array.isArray(d)) setDatasets(d) }).catch(console.error)
    fetch('/api/costs/summary').then(r => r.json()).then(d => setCostData(d)).catch(console.error)
  }, [])

  useEffect(() => {
    fetch(datasetId ? `/api/assets?dataset_id=${datasetId}` : '/api/assets').then(r => r.json()).then(d => { if (Array.isArray(d)) setAssets(d) }).catch(console.error)
  }, [datasetId])

  const metrics = useMemo(() => {
    const byType: Record<string, number> = {}, byGeometry: Record<string, number> = {}, byOwner: Record<string, number> = {}, byStatus: Record<string, number> = {}
    assets.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + 1
      byGeometry[a.geometry?.type || 'Unknown'] = (byGeometry[a.geometry?.type || 'Unknown'] || 0) + 1
      const owner = a.properties?.owner || a.properties?.maintainedby || 'Unknown'; byOwner[owner] = (byOwner[owner] || 0) + 1
      const status = a.status || a.properties?.Status || a.properties?.construction_status || 'Unknown'; byStatus[status] = (byStatus[status] || 0) + 1
    })
    return { total: assets.length, byType, byGeometry, byOwner, byStatus }
  }, [assets])

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Network Insights & Analytics</h1>
            <p className="text-sm text-slate-500 mt-0.5">Asset distribution, cost analysis, and network health metrics across your telecom infrastructure.</p>
          </div>
          <select value={datasetId ?? ''} onChange={e => setDatasetId(e.target.value === '' ? null : Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-blue-300 focus:outline-none">
            <option value="">All datasets</option>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.feature_count})</option>)}
          </select>
        </div>

        {/* Help banner */}
        <div className="mb-6 bg-blue-50 border border-blue-100 rounded-xl px-5 py-3">
          <p className="text-xs text-blue-700">💡 This page shows analytics from your <strong>database</strong>. Upload data via the <Link href="/upload" className="underline font-medium">Upload page</Link>, then return here to see updated charts. For quick map-based analytics, use the Charts tab in the <Link href="/" className="underline font-medium">Map sidebar</Link>.</p>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-4 mb-6">
          {[
            { label: 'Total Assets', value: metrics.total, color: '#2563EB', icon: '📡' },
            { label: 'Network Length', value: costData ? `${costData.totalLengthKm.toFixed(1)} km` : '—', color: '#059669', icon: '📏' },
            { label: 'Total Cost', value: costData ? `$${costData.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', color: '#d97706', icon: '💰' },
            { label: 'Avg Cost/km', value: costData ? `$${costData.avgCostPerKm.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', color: '#7c3aed', icon: '📊' },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2"><span className="text-lg">{c.icon}</span><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{c.label}</p></div>
              <p className="text-2xl font-bold font-mono" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Charts grid */}
        <div className="grid gap-6 lg:grid-cols-2">
          <DistChart title="Distribution by Type" icon="🏷️" data={metrics.byType} total={metrics.total} desc="Asset counts grouped by infrastructure type. Shows what kind of network elements dominate your dataset." />
          <DistChart title="Distribution by Geometry" icon="📐" data={metrics.byGeometry} total={metrics.total} desc="Breakdown by GeoJSON geometry type. Lines = routes/cables, Points = nodes/POPs, Polygons = areas/zones." />
          <DistChart title="Distribution by Owner" icon="🏢" data={metrics.byOwner} total={metrics.total} desc="Asset counts by owner or maintainer. Identifies which organizations manage the most infrastructure." />
          <DistChart title="Distribution by Status" icon="📊" data={metrics.byStatus} total={metrics.total} desc="Operational status breakdown. Active = in service, Planned = under design, Decommissioned = retired." />

          {/* Cost by Vendor */}
          {costData && costData.costByVendor.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2"><span>💰</span>Cost by Vendor</h2>
              <p className="text-[11px] text-slate-400 mb-4">Total infrastructure cost attributed to each vendor. Helps identify vendor cost concentration.</p>
              <div className="space-y-2.5">
                {costData.costByVendor.slice(0, 10).map((v, i) => {
                  const max = costData.costByVendor[0]?.cost || 1
                  return (
                    <div key={v.vendor}>
                      <div className="flex items-center justify-between mb-1">
                        <Link href="/vendors" className="text-xs text-blue-600 font-medium hover:underline no-underline">{v.vendor}</Link>
                        <span className="text-xs font-bold text-slate-800 font-mono">${v.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="h-[6px] w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${(v.cost / max) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }} /></div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Cost by Status */}
          {costData && costData.costByStatus.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2"><span>📈</span>Cost by Status</h2>
              <p className="text-[11px] text-slate-400 mb-4">Cost breakdown by asset status. Shows how much is invested in active vs planned vs retired infrastructure.</p>
              <div className="space-y-2.5">
                {costData.costByStatus.map((s, i) => {
                  const max = costData.costByStatus[0]?.cost || 1
                  const statusColors: Record<string, string> = { active: '#059669', planned: '#d97706', decommissioned: '#64748b', maintenance: '#2563EB' }
                  return (
                    <div key={s.status}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-700 font-medium capitalize">{s.status} <span className="text-slate-400">({s.count} assets)</span></span>
                        <span className="text-xs font-bold text-slate-800 font-mono">${s.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="h-[6px] w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${(s.cost / max) * 100}%`, backgroundColor: statusColors[s.status] || COLORS[i % COLORS.length] }} /></div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-sm text-slate-500">Want to explore further? <Link href="/" className="text-blue-600 font-medium hover:underline">View on Map</Link> &middot; <Link href="/assets" className="text-blue-600 font-medium hover:underline">Browse Assets</Link> &middot; <Link href="/vendors" className="text-blue-600 font-medium hover:underline">Manage Vendors</Link> &middot; <Link href="/dashboard" className="text-blue-600 font-medium hover:underline">Dashboard Overview</Link></p>
        </div>
      </div>
    </div>
  )
}

function DistChart({ title, icon, data, total, desc }: { title: string; icon: string; data: Record<string, number>; total: number; desc: string }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a)
  if (!entries.length) return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2"><span>{icon}</span>{title}</h2><p className="py-6 text-center text-sm text-slate-400">No data yet. <Link href="/upload" className="text-blue-600 underline">Upload data</Link> to see analytics.</p></div>

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2"><span>{icon}</span>{title}</h2>
      <p className="text-[11px] text-slate-400 mb-4">{desc}</p>
      <div className="space-y-2.5">
        {entries.slice(0, 12).map(([type, count], i) => {
          const pct = total > 0 ? (count / total) * 100 : 0; const color = COLORS[i % COLORS.length]
          return (
            <div key={type}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} /><span className="text-xs text-slate-700 font-medium">{type}</span></div>
                <div className="flex items-center gap-2"><span className="text-[10px] text-slate-400">{pct.toFixed(0)}%</span><span className="text-xs font-bold text-slate-800 w-8 text-right font-mono">{count}</span></div>
              </div>
              <div className="h-[6px] w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} /></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
