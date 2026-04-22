'use client'

import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import ArcGISMap, { GeoLayer, MapFilter } from '../../components/ArcGISMap'
import { getOwnerValue, PALETTE } from '../../lib/styling'
import { usePageLoading } from '../../components/LoadingContext'

type ExecPayload = {
  generatedAt: string
  kpis: {
    networkCoveragePct: number
    activeRoutes: number
    totalCost: number
    totalLengthKm: number
    plannedLengthKm: number
    costPerMile: number
  }
  trends: { milesYoyPct: number | null; costYoyPct: number | null; milesAddedYtd: number }
  composition: { type: string; miles: number; count: number; share: number }[]
  ownedVsLeased: { ownedPct: number; leasedPct: number }
  vendorCosts: { name: string; cost: number; miles: number }[]
  costPerMile: {
    id: number; name: string; vendor: string; distance_mi: number;
    total_cost: number; cost_per_mile: number; status: string; utilization_pct: number | null;
  }[]
  facilities: { type: string; total: number; online: number; offline: number; warning: number; capacity: number; utilization: number }[]
  activePlan: { id: number; name: string; target_year: number; planned_miles: number; budget: number; status: string } | null
  plans: any[]
}

const TYPE_COLORS: Record<string, string> = {
  owned: '#2563EB',
  leased: '#F59E0B',
  waves: '#A855F7',
  planned: '#10B981',
  other: '#64748B',
  pops: '#EF4444',
  wirecenters: '#06B6D4',
  colo: '#F97316',
  datacenters: '#8B5CF6',
}
// Brighter palette for vendor bars
const VENDOR_BAR_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#EAB308',
  '#10B981', '#14B8A6', '#06B6D4', '#6366F1', '#D946EF',
]
const TYPE_LABELS: Record<string, string> = {
  owned: 'Owned', leased: 'Leased', waves: 'Waves', planned: 'Planned',
  other: 'Other', pops: 'POPs', wirecenters: 'Wire Centers', colo: 'Co-Lo', datacenters: 'Data Centers',
}

function formatCompact(n: number) {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function formatMoney(n: number) { return '$' + formatCompact(n) }
function formatSigned(n: number | null, suffix = '%') {
  if (n == null) return '—'
  const s = n > 0 ? '+' : ''
  return `${s}${n.toFixed(1)}${suffix}`
}
function heatmapColor(value: number, min: number, max: number): string {
  if (max === min) return 'linear-gradient(135deg,#10b981,#059669)'
  const t = (value - min) / (max - min)
  if (t < 0.34) return 'linear-gradient(135deg,#10b981,#059669)'
  if (t < 0.67) return 'linear-gradient(135deg,#f59e0b,#d97706)'
  return 'linear-gradient(135deg,#ef4444,#b91c1c)'
}
function heatmapText(_value: number, _min: number, _max: number): string {
  return '#ffffff'
}

type RouteFilter = 'all' | 'owned' | 'leased' | 'planned'
type ColorMode = 'layer' | 'vendor' | 'owner'

interface Vendor { id: number; name: string }

const FACILITY_TYPES_SET = new Set(['pops', 'wirecenters', 'colo', 'datacenters'])
function isRouteType(t: string | null | undefined): boolean {
  if (!t) return false
  return !FACILITY_TYPES_SET.has(t.toLowerCase())
}

// Classify each asset into a route category (owned/leased/planned/etc.)
// The DB `type` column actually stores geometry type (LineString/Point/…),
// not the route category. Category is inferred from the dataset or folder
// name via these patterns — same rules the map page uses.
const AUTO_RULES: { p: RegExp; t: string }[] = [
  { p: /own(ed)?[\s_-]?fib/i, t: 'owned' },
  { p: /dark[\s_-]?fib|lease/i, t: 'leased' },
  { p: /wave|lit[\s_-]?cap/i, t: 'waves' },
  { p: /plan|desired|future/i, t: 'planned' },
  { p: /\bpop\b|point.of.pres/i, t: 'pops' },
  { p: /wire.?cent|switch/i, t: 'wirecenters' },
  { p: /co.?lo|coloc/i, t: 'colo' },
  { p: /data.?cent|dc[\s_-]/i, t: 'datacenters' },
]

function classifyAsset(asset: any, datasetNameById: Map<number, string>): string {
  const folder = Array.isArray(asset.properties?.__folder)
    ? asset.properties.__folder[asset.properties.__folder.length - 1]
    : null
  if (folder) for (const r of AUTO_RULES) if (r.p.test(String(folder))) return r.t
  const ds = asset.dataset_id != null ? datasetNameById.get(asset.dataset_id) : null
  if (ds) for (const r of AUTO_RULES) if (r.p.test(String(ds))) return r.t
  if (asset.name) for (const r of AUTO_RULES) if (r.p.test(String(asset.name))) return r.t
  const tags = [asset.properties?.network_type, asset.properties?.Category, asset.properties?.layer, asset.properties?.Layer]
  for (const tg of tags) {
    if (tg) for (const r of AUTO_RULES) if (r.p.test(String(tg))) return r.t
  }
  return 'other'
}

export default function DashboardPage() {
  const [data, setData] = useState<ExecPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [layers, setLayers] = useState<GeoLayer[]>([])
  const [assets, setAssets] = useState<any[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [datasets, setDatasets] = useState<{ id: number; name: string }[]>([])
  const [routeFilter, setRouteFilter] = useState<RouteFilter>('all')
  const [editingPlan, setEditingPlan] = useState(false)

  // Map-panel filters
  const [hiddenVendors, setHiddenVendors] = useState<Set<string>>(new Set())
  const [hiddenOwners, setHiddenOwners] = useState<Set<string>>(new Set())
  const [colorMode, setColorMode] = useState<ColorMode>('layer')
  const [filterOpen, setFilterOpen] = useState(false)

  // Splash synchronisation — stay up until dashboard aggregation + assets land
  usePageLoading('dashboard-summary', !data && !err, 'Loading dashboard summary…')
  usePageLoading('dashboard-assets', assets.length === 0, 'Fetching network assets…')

  useEffect(() => {
    fetch('/api/dashboard/summary')
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setData(d) })
      .catch(e => setErr(e.message))
    fetch('/api/vendors').then(r => r.json()).then(d => { if (Array.isArray(d)) setVendors(d) }).catch(() => {})
    fetch('/api/datasets').then(r => r.json()).then(d => { if (Array.isArray(d)) setDatasets(d) }).catch(() => {})
  }, [])

  const datasetNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const d of datasets) m.set(d.id, d.name)
    return m
  }, [datasets])

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/assets').then(r => r.json())
        if (!Array.isArray(res)) return
        setAssets(res)
      } catch (e) { console.error('[dashboard] asset load failed', e) }
    })()
  }, [])

  // Build map layers from assets + datasets, grouping by route category
  useEffect(() => {
    if (assets.length === 0) return
    const buckets = new Map<string, GeoJSON.Feature[]>()
    for (const a of assets) {
      const category = classifyAsset(a, datasetNameById)
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: a.geometry,
        properties: {
          ...a.properties,
          name: a.name || a.properties?.name,
          status: a.status,
          operational_status: a.operational_status,
          utilization_pct: a.utilization_pct,
          length_km: a.length_km,
          vendor_id: a.vendor_id,
          total_cost: a.total_cost,
          __category: category,
        },
      }
      const arr = buckets.get(category) || []
      arr.push(feature)
      buckets.set(category, arr)
    }
    const built: GeoLayer[] = []
    let i = 0
    for (const [cat, features] of buckets) {
      built.push({
        id: String(i++),
        name: TYPE_LABELS[cat] || cat,
        color: TYPE_COLORS[cat] || '#64748b',
        visible: true,
        geojson: { type: 'FeatureCollection', features },
        geomType: features[0]?.geometry?.type || 'Unknown',
        count: features.length,
      })
    }
    setLayers(built)
  }, [assets, datasetNameById])

  const vendorNameMap = useMemo(() => {
    const m: Record<number, string> = {}
    for (const v of vendors) m[v.id] = v.name
    return m
  }, [vendors])

  // Derive vendor + owner facets from loaded assets
  const facets = useMemo(() => {
    const vMap = new Map<string, { id: string; name: string; count: number }>()
    const oMap = new Map<string, number>()
    let noVendor = 0, noOwner = 0
    for (const a of assets) {
      const vid = a.vendor_id
      if (vid != null) {
        const k = String(vid)
        const v = vMap.get(k) || { id: k, name: vendorNameMap[vid] || `Vendor #${vid}`, count: 0 }
        v.count++
        vMap.set(k, v)
      } else noVendor++
      const owner = getOwnerValue(a.properties)
      if (owner) oMap.set(owner, (oMap.get(owner) || 0) + 1)
      else noOwner++
    }
    return {
      vendors: Array.from(vMap.values()).sort((a, b) => b.count - a.count),
      owners: Array.from(oMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      noVendor, noOwner,
    }
  }, [assets, vendorNameMap])

  const vendorColorMap = useMemo(() => {
    const m: Record<string, string> = { __none__: '#94a3b8' }
    facets.vendors.forEach((v, i) => { m[v.id] = PALETTE[i % PALETTE.length] })
    return m
  }, [facets])
  const ownerColorMap = useMemo(() => {
    const m: Record<string, string> = { __none__: '#94a3b8' }
    facets.owners.forEach((o, i) => { m[o.name] = PALETTE[i % PALETTE.length] })
    return m
  }, [facets])

  const mapFilter: MapFilter = useMemo(() => ({
    hiddenVendors, hiddenOwners, vendorColorMap, ownerColorMap, colorMode,
  }), [hiddenVendors, hiddenOwners, vendorColorMap, ownerColorMap, colorMode])

  // Apply route pill — show the selected category + all facility layers,
  // hide everything else. Facilities are always visible so POPs/DCs still render.
  const filteredLayers = useMemo(() => {
    if (routeFilter === 'all') return layers
    return layers.map(l => {
      // Each layer is named after its category (Owned, Leased, etc.)
      const key = l.name.toLowerCase().replace(/\s+/g, '')
      const isFacility = ['pops', 'wirecenters', 'co-lo', 'datacenters'].some(x => key.includes(x.replace(/-/g, '')))
      const matches = l.name.toLowerCase() === TYPE_LABELS[routeFilter]?.toLowerCase()
      return { ...l, visible: matches || isFacility }
    })
  }, [layers, routeFilter])

  // Filtered Cost/Mile and Vendor Costs that respect the map-panel filters
  const filteredCostPerMile = useMemo(() => {
    if (!data) return []
    return data.costPerMile.filter(r => {
      // Hide rows whose vendor is hidden. Match by name since that's what server returns.
      if (hiddenVendors.size > 0) {
        const v = facets.vendors.find(x => x.name === r.vendor)
        const key = v ? v.id : '__none__'
        if (hiddenVendors.has(key)) return false
      }
      return true
    })
  }, [data, hiddenVendors, facets.vendors])

  const filteredVendorCosts = useMemo(() => {
    if (!data) return []
    return data.vendorCosts.filter(v => {
      const match = facets.vendors.find(x => x.name === v.name)
      if (!match) return true
      return !hiddenVendors.has(match.id)
    })
  }, [data, hiddenVendors, facets.vendors])

  const activeFilterCount = hiddenVendors.size + hiddenOwners.size

  // Recompute KPIs / composition / bottom-strip stats from the filtered asset set.
  // Falls back to server aggregation while assets are still loading.
  const derived = useMemo(() => {
    if (assets.length === 0 || !data) return null
    const filtered = assets.filter(a => {
      const vkey = a.vendor_id != null ? String(a.vendor_id) : '__none__'
      if (hiddenVendors.has(vkey)) return false
      const owner = getOwnerValue(a.properties)
      const okey = owner || '__none__'
      if (hiddenOwners.has(okey)) return false
      // Route pill filter
      if (routeFilter !== 'all') {
        const cat = classifyAsset(a, datasetNameById)
        if (cat !== routeFilter) return false
      }
      return true
    })

    // Tag every row with a category for downstream grouping
    const withCategory = filtered.map(a => ({ ...a, __category: classifyAsset(a, datasetNameById) }))
    const routes = withCategory.filter(a => !FACILITY_TYPES_SET.has(a.__category))
    const online = routes.filter(a => (a.operational_status || 'online') === 'online').length
    const totalCost = withCategory.reduce((s, a) => s + (Number(a.total_cost) || 0), 0)
    const totalLengthKm = routes.reduce((s, a) => s + (Number(a.length_km) || 0), 0)
    const totalMiles = totalLengthKm * 0.621371
    const coverage = routes.length ? Math.round((online / routes.length) * 1000) / 10 : 0
    const costPerMile = totalMiles > 0.01 ? Math.round(totalCost / totalMiles) : 0

    // Composition by category (owned / leased / planned / waves / other)
    const compMap = new Map<string, { miles: number; count: number }>()
    for (const a of routes) {
      const key = a.__category
      const c = compMap.get(key) || { miles: 0, count: 0 }
      c.miles += Number(a.length_km) || 0
      c.count += 1
      compMap.set(key, c)
    }
    const composition = Array.from(compMap.entries()).map(([type, v]) => ({
      type,
      miles: Math.round(v.miles * 10) / 10,
      count: v.count,
      share: totalLengthKm ? Math.round((v.miles / totalLengthKm) * 1000) / 10 : 0,
    })).sort((a, b) => b.miles - a.miles)

    const ownedMiles = compMap.get('owned')?.miles || 0
    const leasedMiles = compMap.get('leased')?.miles || 0
    const ownedPct = totalLengthKm ? Math.round((ownedMiles / totalLengthKm) * 1000) / 10 : 0
    const leasedPct = totalLengthKm ? Math.round((leasedMiles / totalLengthKm) * 1000) / 10 : 0
    const popsCount = withCategory.filter(a => a.__category === 'pops').length

    return {
      activeRoutes: online,
      totalCost: Math.round(totalCost),
      totalLengthKm,
      totalMiles: Math.round(totalMiles),
      coverage,
      costPerMile,
      composition,
      ownedPct,
      leasedPct,
      popsCount,
    }
  }, [assets, data, hiddenVendors, hiddenOwners, routeFilter, datasetNameById])

  function toggleVendor(id: string) {
    setHiddenVendors(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleOwner(name: string) {
    setHiddenOwners(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
  }
  function clearAllFilters() {
    setHiddenVendors(new Set()); setHiddenOwners(new Set()); setColorMode('layer')
  }

  if (err) {
    return (
      <div className="h-[calc(100vh-52px)] flex items-center justify-center bg-slate-50">
        <div className="bg-white border border-red-100 rounded-lg p-6 max-w-md">
          <div className="text-red-700 font-semibold mb-2">Failed to load dashboard</div>
          <div className="text-xs text-slate-600 font-mono break-all">{err}</div>
          <div className="text-[11px] text-slate-500 mt-3">If this mentions a missing column, run the latest migration in <code className="bg-slate-100 px-1 rounded">database/migrations/</code> in your Supabase SQL editor.</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="h-[calc(100vh-52px)] flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-600">Loading Dashboard…</span>
        </div>
      </div>
    )
  }

  const costMin = filteredCostPerMile.length ? Math.min(...filteredCostPerMile.map(r => r.cost_per_mile)) : 0
  const costMax = filteredCostPerMile.length ? Math.max(...filteredCostPerMile.map(r => r.cost_per_mile)) : 1

  // Display values — prefer filter-aware client-side values when available,
  // otherwise fall back to server aggregation.
  const activeRoutes = derived?.activeRoutes ?? data.kpis.activeRoutes
  const totalCost = derived?.totalCost ?? data.kpis.totalCost
  const coverage = derived?.coverage ?? data.kpis.networkCoveragePct
  const costPerMile = derived?.costPerMile ?? data.kpis.costPerMile
  const totalMiles = derived?.totalMiles ?? Math.round(data.kpis.totalLengthKm * 0.621371)
  const composition = derived?.composition ?? data.composition
  const ownedPct = derived?.ownedPct ?? data.ownedVsLeased.ownedPct
  const leasedPct = derived?.leasedPct ?? data.ownedVsLeased.leasedPct
  const popsCount = derived?.popsCount ?? (data.facilities.find(f => f.type === 'pops')?.total || 0)

  const activePlan = data.activePlan
  const plannedRoutes = activePlan ? Number(activePlan.planned_miles) : data.kpis.plannedLengthKm
  const planBudget = activePlan ? Number(activePlan.budget) : 0

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto text-slate-900 relative"
         style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #faf5ff 50%, #fef3f2 100%)' }}>
      {/* Subtle color mesh background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl opacity-20" style={{ background: '#3b82f6' }} />
        <div className="absolute top-40 -right-32 w-96 h-96 rounded-full blur-3xl opacity-15" style={{ background: '#a855f7' }} />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 rounded-full blur-3xl opacity-15" style={{ background: '#10b981' }} />
      </div>

      <div className="max-w-[1600px] mx-auto px-5 py-4 relative">

        {/* ── TITLE BAR ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4 bg-white/70 backdrop-blur border border-white rounded-xl shadow-sm px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex gap-0.5">
              <div className="w-2 h-3 bg-emerald-500 rounded-sm" />
              <div className="w-2 h-3 bg-emerald-600 rounded-sm mt-1" />
            </div>
            <h1 className="text-xl font-bold tracking-tight"
                style={{ background: 'linear-gradient(90deg, #1e40af, #7c3aed, #db2777)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Network Dashboard
            </h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </span>
            {activeFilterCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-[10px] font-semibold shadow-sm">
                {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
                <button onClick={clearAllFilters} className="text-white/80 hover:text-white">✕</button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <KpiChip label="Network Coverage" value={`${coverage}%`} from="#10b981" to="#14b8a6" />
            <KpiChip label="Active Routes" value={activeRoutes.toLocaleString()} from="#3b82f6" to="#06b6d4" />
            <KpiChip label="Total Cost" value={formatMoney(totalCost)} from="#f59e0b" to="#ef4444" />
          </div>
        </div>

        {/* ── 3-COL GRID ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-12 gap-3">

          {/* LEFT COLUMN */}
          <div className="col-span-12 lg:col-span-3 space-y-3">
            <Card title="Network Composition" accent="#8b5cf6">
              <div className="h-[180px] relative">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={composition}
                      dataKey="miles"
                      nameKey="type"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={2}
                      startAngle={90}
                      endAngle={-270}
                    >
                      {composition.map((d, i) => (
                        <Cell key={i} fill={TYPE_COLORS[d.type] || '#64748b'} stroke="white" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any, n: any) => [`${Math.round(v)} km`, TYPE_LABELS[n] || n]}
                      contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-[9px] uppercase tracking-widest text-slate-400">Total Miles</div>
                  <div className="text-xl font-semibold text-slate-900">{totalMiles.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {composition.slice(0, 4).map(d => (
                  <div key={d.type} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLORS[d.type] || '#64748b' }} />
                      <span className="text-slate-700 capitalize">{TYPE_LABELS[d.type] || d.type}</span>
                    </div>
                    <span className="text-slate-500 tabular-nums font-mono">
                      {d.share}% · {formatCompact(Math.round(d.miles * 0.621371))} mi
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Vendor Cost Comparison (Annual)" accent="#3b82f6">
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <BarChart
                    data={filteredVendorCosts.map(v => ({ ...v, cost: Math.round(v.cost) }))}
                    layout="vertical"
                    margin={{ top: 4, right: 44, left: 4, bottom: 4 }}
                  >
                    <defs>
                      {VENDOR_BAR_COLORS.map((c, i) => (
                        <linearGradient key={i} id={`vbar-${i}`} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor={c} stopOpacity={0.7} />
                          <stop offset="100%" stopColor={c} stopOpacity={1} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={64}
                           tick={{ fontSize: 10, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: any) => formatMoney(v as number)}
                             contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6 }} />
                    <Bar dataKey="cost" radius={[0, 6, 6, 0]}
                         label={{ position: 'right', fontSize: 10, fill: '#0f172a', fontWeight: 600, formatter: (v: any) => formatMoney(v as number) }}>
                      {filteredVendorCosts.map((_, i) => (
                        <Cell key={i} fill={`url(#vbar-${i % VENDOR_BAR_COLORS.length})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {filteredVendorCosts.length === 0 && (
                <div className="text-[11px] text-slate-400 text-center py-4">
                  {data.vendorCosts.length > 0 ? 'All vendors hidden by filters.' : 'No vendor cost data yet. Assign vendors to assets.'}
                </div>
              )}
            </Card>
          </div>

          {/* CENTER COLUMN */}
          <div className="col-span-12 lg:col-span-6 space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <TrendTile icon="🏢" label="Owned Network"
                value={formatSigned(data.trends.milesYoyPct)} sub="vs Last Year"
                positive={(data.trends.milesYoyPct ?? 0) >= 0}
                gradient={['#3b82f6', '#1e40af']} />
              <TrendTile icon="💰" label="Annual Lease Cost"
                value={formatSigned(data.trends.costYoyPct != null ? -data.trends.costYoyPct : null)}
                sub="Efficiency Gain" positive={(data.trends.costYoyPct ?? 0) <= 0}
                gradient={['#f59e0b', '#d97706']} />
              <TrendTile icon="🛣️" label="Route Miles"
                value={`+${formatCompact(data.trends.milesAddedYtd)}`}
                sub="Miles Added YTD" positive
                gradient={['#8b5cf6', '#6d28d9']} />
              <TrendTile icon="📅"
                label={`Miles Planned ${activePlan?.target_year || '2027'}`}
                value={activePlan ? 'On Track' : '—'}
                sub={activePlan ? `${formatCompact(Number(activePlan.planned_miles))} mi goal` : 'Set in plans'}
                positive textValue
                gradient={['#10b981', '#047857']} />
            </div>

            {/* Map card with toolbar */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400" />
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 rounded-sm bg-gradient-to-b from-blue-500 to-cyan-400" />
                  <div className="text-sm font-semibold text-slate-800">Network Map & Visualization</div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Map-panel filters button */}
                  <button
                    onClick={() => setFilterOpen(o => !o)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition shadow-sm ${
                      filterOpen || activeFilterCount > 0
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 6h16M7 12h10M10 18h4" />
                    </svg>
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-white text-blue-600 text-[9px] font-bold">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>

                  {/* Route type pills */}
                  <div className="flex gap-1 bg-slate-100 rounded-md p-0.5 text-[11px]">
                    {([
                      { k: 'all', label: 'All Routes', from: '#3b82f6', to: '#6366f1' },
                      { k: 'owned', label: 'Owned', from: '#2563eb', to: '#1d4ed8' },
                      { k: 'leased', label: 'Leased', from: '#f59e0b', to: '#d97706' },
                      { k: 'planned', label: 'Planned', from: '#10b981', to: '#059669' },
                    ] as const).map(f => (
                      <button
                        key={f.k}
                        onClick={() => setRouteFilter(f.k as RouteFilter)}
                        className={`px-2.5 py-1 rounded capitalize font-semibold transition ${
                          routeFilter === f.k ? 'text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                        }`}
                        style={routeFilter === f.k ? { background: `linear-gradient(90deg, ${f.from}, ${f.to})` } : undefined}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="h-[440px] relative">
                <ArcGISMap layers={filteredLayers} filter={mapFilter} />

                {/* Filter dropdown overlay */}
                {filterOpen && (
                  <div className="absolute top-3 left-3 z-[10] bg-white rounded-lg shadow-2xl border border-slate-200 w-[320px] max-h-[420px] flex flex-col overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                      <div className="text-xs font-semibold text-slate-800">Map Filters</div>
                      <div className="flex items-center gap-2">
                        {activeFilterCount > 0 && (
                          <button onClick={clearAllFilters} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">Clear all</button>
                        )}
                        <button onClick={() => setFilterOpen(false)} className="text-slate-400 hover:text-slate-700 text-sm leading-none">✕</button>
                      </div>
                    </div>

                    <div className="overflow-y-auto px-3 py-3 space-y-3 text-[11px]">
                      {/* Color mode */}
                      <div>
                        <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Color Mode</div>
                        <div className="grid grid-cols-3 gap-1 bg-slate-100 rounded-md p-0.5">
                          {(['layer', 'vendor', 'owner'] as ColorMode[]).map(m => (
                            <button
                              key={m}
                              onClick={() => setColorMode(m)}
                              className={`py-1 rounded text-[10px] font-semibold capitalize transition ${
                                colorMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >{m}</button>
                          ))}
                        </div>
                      </div>

                      {/* Vendors */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                            Vendors ({facets.vendors.length})
                          </div>
                          {hiddenVendors.size > 0 && (
                            <button onClick={() => setHiddenVendors(new Set())} className="text-[10px] text-blue-600 hover:text-blue-800">Clear</button>
                          )}
                        </div>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto border border-slate-100 rounded-md p-1">
                          {facets.vendors.map(v => {
                            const hidden = hiddenVendors.has(v.id)
                            return (
                              <label key={v.id} className="flex items-center gap-2 py-0.5 px-1.5 rounded hover:bg-slate-50 cursor-pointer">
                                <input type="checkbox" checked={!hidden} onChange={() => toggleVendor(v.id)}
                                       className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: vendorColorMap[v.id] }} />
                                <span className={`flex-1 truncate ${hidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{v.name}</span>
                                <span className="text-[9px] text-slate-400 font-mono tabular-nums">{v.count}</span>
                              </label>
                            )
                          })}
                          {facets.noVendor > 0 && (
                            <label className="flex items-center gap-2 py-0.5 px-1.5 rounded hover:bg-slate-50 cursor-pointer">
                              <input type="checkbox"
                                     checked={!hiddenVendors.has('__none__')}
                                     onChange={() => toggleVendor('__none__')}
                                     className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                              <span className="w-2 h-2 rounded-sm shrink-0 bg-slate-400" />
                              <span className="flex-1 italic text-slate-500">No vendor</span>
                              <span className="text-[9px] text-slate-400 font-mono tabular-nums">{facets.noVendor}</span>
                            </label>
                          )}
                          {facets.vendors.length === 0 && facets.noVendor === 0 && (
                            <div className="text-slate-400 text-center py-2">No vendor data</div>
                          )}
                        </div>
                      </div>

                      {/* Owners */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                            Owners ({facets.owners.length})
                          </div>
                          {hiddenOwners.size > 0 && (
                            <button onClick={() => setHiddenOwners(new Set())} className="text-[10px] text-blue-600 hover:text-blue-800">Clear</button>
                          )}
                        </div>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto border border-slate-100 rounded-md p-1">
                          {facets.owners.slice(0, 40).map(o => {
                            const hidden = hiddenOwners.has(o.name)
                            return (
                              <label key={o.name} className="flex items-center gap-2 py-0.5 px-1.5 rounded hover:bg-slate-50 cursor-pointer">
                                <input type="checkbox" checked={!hidden} onChange={() => toggleOwner(o.name)}
                                       className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: ownerColorMap[o.name] }} />
                                <span className={`flex-1 truncate ${hidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{o.name}</span>
                                <span className="text-[9px] text-slate-400 font-mono tabular-nums">{o.count}</span>
                              </label>
                            )
                          })}
                          {facets.owners.length === 0 && (
                            <div className="text-slate-400 text-center py-2">No owner data</div>
                          )}
                        </div>
                      </div>

                      <div className="text-[10px] text-slate-400 leading-snug pt-1 border-t border-slate-100">
                        Filters apply to the map and every KPI, chart and panel on this page. Plan & budget values are not affected.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="col-span-12 lg:col-span-3 space-y-3">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" />
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between"
                   style={{ background: 'linear-gradient(90deg, #fef3c7, #fef9c3)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 rounded-sm bg-gradient-to-b from-amber-500 to-orange-500" />
                  <div className="text-sm font-bold text-slate-900">Cost Per Mile Heatmap Table</div>
                </div>
                {hiddenVendors.size > 0 && (
                  <span className="text-[9px] text-white bg-gradient-to-r from-amber-600 to-orange-600 px-2 py-0.5 rounded-full font-semibold">filtered</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-slate-500 bg-slate-50">
                      <th className="text-left px-3 py-1.5 font-semibold">Route Segment</th>
                      <th className="text-right px-2 py-1.5 font-semibold">Distance (mi)</th>
                      <th className="text-right px-2 py-1.5 font-semibold">Annual Cost</th>
                      <th className="text-right px-3 py-1.5 font-semibold">Cost/Mile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCostPerMile.map(r => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-800 truncate max-w-[120px]">{r.name}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums">{r.distance_mi}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums">{formatMoney(r.total_cost)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          <span className="inline-block px-2 py-0.5 rounded-full font-bold text-[10px] shadow-sm"
                                style={{ background: heatmapColor(r.cost_per_mile, costMin, costMax), color: heatmapText(r.cost_per_mile, costMin, costMax) }}>
                            ${r.cost_per_mile}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredCostPerMile.length === 0 && (
                      <tr><td colSpan={4} className="text-center text-[11px] text-slate-400 py-4">
                        {data.costPerMile.length > 0 ? 'No rows match the active filters.' : 'No route cost data yet.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* CTA to fill missing data — shows when we have assets but few cost rows */}
              {assets.length > 0 && filteredCostPerMile.length < 5 && !hiddenVendors.size && (
                <div className="border-t border-amber-100 bg-amber-50/40 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-amber-800">
                    Only {filteredCostPerMile.length} route{filteredCostPerMile.length === 1 ? '' : 's'} have cost data.
                  </div>
                  <a href="/assets/fill" className="text-[10px] font-bold text-white px-2 py-1 rounded shadow-sm"
                     style={{ background: 'linear-gradient(90deg, #f59e0b, #ef4444)' }}>
                    Fill Data Gaps →
                  </a>
                </div>
              )}
            </div>

            <Card title="Financial & Growth Overview" accent="#ec4899">
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Annual Lease Cost" value={formatMoney(totalCost)} accent="#f59e0b" />
                <MiniStat label="Cost per Mile" value={`$${formatCompact(costPerMile)}`} accent="#ef4444" />
                <MiniStat label={`${activePlan?.target_year || '2027'} Expansion`}
                          value={`${formatCompact(plannedRoutes)} mi`} sub="Planned Routes"
                          editable onEdit={() => setEditingPlan(true)} accent="#10b981" />
                <MiniStat label="Budget" value={formatMoney(planBudget)} editable
                          onEdit={() => setEditingPlan(true)} accent="#8b5cf6" />
              </div>
            </Card>
          </div>
        </div>

        {/* ── BOTTOM STRIP ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-12 gap-3 mt-3">
          <div className="col-span-12 md:col-span-5 rounded-xl overflow-hidden shadow-sm"
               style={{ background: 'linear-gradient(135deg, #dbeafe, #ffffff)' }}>
            <div className="h-1 bg-gradient-to-r from-blue-500 to-amber-400" />
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">📡</span>
                  <div className="text-sm font-bold text-slate-800">Network Overview</div>
                </div>
                <div className="text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                  {popsCount} Active POPs
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ShareBar label="Owned Network" pct={ownedPct} color="#2563EB" />
                <ShareBar label="Leased Network" pct={leasedPct} color="#F59E0B" />
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-4 rounded-xl overflow-hidden shadow-sm"
               style={{ background: 'linear-gradient(135deg, #fef3c7, #ffffff)' }}>
            <div className="h-1 bg-gradient-to-r from-amber-400 to-red-400" />
            <div className="p-4">
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="text-base">💰</span>
                <div className="text-sm font-bold text-slate-800">Cost Analysis</div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">Annual Lease Cost</div>
                  <div className="text-2xl font-bold tabular-nums mt-0.5"
                       style={{ background: 'linear-gradient(90deg, #d97706, #b91c1c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {formatMoney(totalCost)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-red-700">Cost per Mile</div>
                  <div className="text-2xl font-bold tabular-nums mt-0.5"
                       style={{ background: 'linear-gradient(90deg, #dc2626, #7c2d12)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    ${formatCompact(costPerMile)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-3 rounded-xl overflow-hidden shadow-sm"
               style={{ background: 'linear-gradient(135deg, #d1fae5, #ffffff)' }}>
            <div className="h-1 bg-gradient-to-r from-emerald-500 to-purple-500" />
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">🚀</span>
                  <div className="text-sm font-bold text-slate-800">{activePlan?.target_year || '2027'} Expansion</div>
                </div>
                <button onClick={() => setEditingPlan(true)} className="text-[10px] text-emerald-700 hover:text-emerald-900 underline font-medium">edit</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">Planned Routes</div>
                  <div className="text-xl font-bold tabular-nums mt-0.5"
                       style={{ background: 'linear-gradient(90deg, #059669, #047857)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {formatCompact(plannedRoutes)} mi
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-purple-700">Budget</div>
                  <div className="text-xl font-bold tabular-nums mt-0.5"
                       style={{ background: 'linear-gradient(90deg, #7c3aed, #6d28d9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {formatMoney(planBudget)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center text-[10px] text-slate-400 mt-4 font-mono">
          Generated {new Date(data.generatedAt).toLocaleString()} · Cably Dashboard · {assets.length.toLocaleString()} features loaded
        </div>
      </div>

      {editingPlan && activePlan && (
        <EditPlanModal plan={activePlan} onClose={() => setEditingPlan(false)}
          onSaved={() => { setEditingPlan(false); fetch('/api/dashboard/summary').then(r => r.json()).then(setData) }} />
      )}
      {editingPlan && !activePlan && (
        <EditPlanModal
          plan={{ id: 0, name: 'Expansion Plan', target_year: new Date().getFullYear() + 1, planned_miles: 0, budget: 0, status: 'on_track' }}
          onClose={() => setEditingPlan(false)}
          onSaved={() => { setEditingPlan(false); fetch('/api/dashboard/summary').then(r => r.json()).then(setData) }}
          creating />
      )}
    </div>
  )
}

/* ── Small components ────────────────────────────────────────────────────── */
function KpiChip({ label, value, from, to }: { label: string; value: string; from: string; to: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg px-3 py-1.5 shadow-sm" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <div className="text-[9px] uppercase tracking-wider text-white/80 font-medium">{label}</div>
      <div className="text-base font-bold text-white tabular-nums leading-tight">{value}</div>
    </div>
  )
}
function Card({ title, children, accent = '#3b82f6' }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}40)` }} />
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
        <div className="w-1.5 h-4 rounded-sm" style={{ background: accent }} />
        <div className="text-sm font-semibold text-slate-800">{title}</div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}
function TrendTile({ icon, label, value, sub, positive, textValue, gradient }: {
  icon: string; label: string; value: string; sub: string; positive?: boolean; textValue?: boolean; gradient: [string, string]
}) {
  const arrow = textValue ? '→' : (positive ? '↗' : '↘')
  const valueColor = positive ? 'text-emerald-100' : 'text-red-100'
  return (
    <div className="relative rounded-xl px-3 py-2 min-w-0 shadow-sm overflow-hidden"
         style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}>
      <div className="absolute top-0 right-0 text-3xl opacity-20 leading-none -mt-1 -mr-1">{icon}</div>
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <span className="text-base">{icon}</span>
          <div className="text-[10px] font-semibold text-white/90 truncate">{label}</div>
        </div>
        <div className={`flex items-center gap-1 mt-1 text-sm font-bold ${valueColor}`}>
          <span>{arrow}</span>
          <span className="tabular-nums">{value}</span>
        </div>
        <div className="text-[9px] text-white/70 mt-0.5 truncate">{sub}</div>
      </div>
    </div>
  )
}
function MiniStat({ label, value, sub, editable, onEdit, accent = '#3b82f6' }: {
  label: string; value: string; sub?: string; editable?: boolean; onEdit?: () => void; accent?: string
}) {
  return (
    <div className="rounded-lg p-2.5 border relative group overflow-hidden"
         style={{ background: `linear-gradient(135deg, ${accent}10, ${accent}05)`, borderColor: `${accent}30` }}>
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />
      <div className="pl-2">
        <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: accent }}>{label}</div>
        <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
        {sub && <div className="text-[9px] text-slate-500 mt-0.5">{sub}</div>}
      </div>
      {editable && (
        <button onClick={onEdit}
                className="absolute top-1 right-1 text-[9px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: accent }}>
          edit
        </button>
      )}
    </div>
  )
}
function ShareBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold" style={{ color }}>{label}</span>
        <span className="text-sm font-bold text-slate-900 tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700 shadow-sm"
             style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}cc, ${color})` }} />
      </div>
    </div>
  )
}

/* ── Plan editor modal ───────────────────────────────────────────────────── */
function EditPlanModal({ plan, onClose, onSaved, creating }: {
  plan: { id: number; name: string; target_year: number; planned_miles: number; budget: number; status: string };
  onClose: () => void; onSaved: () => void; creating?: boolean
}) {
  const [form, setForm] = useState(plan)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setSaving(true); setError(null)
    try {
      const method = creating ? 'POST' : 'PUT'
      const url = creating ? '/api/plans' : `/api/plans/${plan.id}`
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      onSaved()
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-semibold text-slate-900">
            {creating ? 'Create Expansion Plan' : `Edit ${plan.name}`}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="space-y-3">
          <Field label="Plan name">
            <input className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm"
                   value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target year">
              <input type="number" className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm tabular-nums"
                     value={form.target_year} onChange={e => setForm({ ...form, target_year: Number(e.target.value) })} />
            </Field>
            <Field label="Status">
              <select className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm"
                      value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="on_track">On Track</option>
                <option value="at_risk">At Risk</option>
                <option value="behind">Behind</option>
                <option value="complete">Complete</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Planned miles">
              <input type="number" step="0.1" className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm tabular-nums"
                     value={form.planned_miles} onChange={e => setForm({ ...form, planned_miles: Number(e.target.value) })} />
            </Field>
            <Field label="Budget (USD)">
              <input type="number" step="1000" className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm tabular-nums"
                     value={form.budget} onChange={e => setForm({ ...form, budget: Number(e.target.value) })} />
            </Field>
          </div>
          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
          <button onClick={save} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">{label}</div>
      {children}
    </label>
  )
}
