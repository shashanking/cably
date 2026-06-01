'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ArcGISMap, { GeoLayer } from '../../../components/ArcGISMap'
import { usePageLoading } from '../../../components/LoadingContext'

/** Slim row returned by /api/assets/gaps — no geometry, minimal properties. */
interface Asset {
  id: number
  dataset_id: number | null
  name: string | null
  type: string
  vendor_id: number | null
  status: string | null
  operational_status: string | null
  utilization_pct: number | null
  capacity_pct: number | null
  region: string | null
  installed_year: number | null
  cost_per_km: number | null
  total_cost: number | null
  length_km: number | null
  _folder: string[] | null
  _prop_name: string | null
  _group: string | null
  _facility: string | null
}
/** Full asset (fetched lazily for the drawer — includes geometry + properties). */
interface FullAsset extends Omit<Asset, '_folder' | '_prop_name'> {
  geometry: any
  properties: any
}
interface Vendor { id: number; name: string }
interface Dataset { id: number; name: string; source_file: string | null; feature_count: number }

function folderPath(a: Asset): string {
  const f = a._folder
  if (Array.isArray(f) && f.length > 0) return f.join(' / ')
  return ''
}
function displayName(a: Asset | FullAsset): string {
  const propName = '_prop_name' in a ? a._prop_name : (a as any).properties?.name || (a as any).properties?.Name
  const raw = (a.name || propName || '').trim()
  if (raw) return raw
  const folder = '_folder' in a ? (a._folder || []) : ((a as any).properties?.__folder || [])
  if (Array.isArray(folder) && folder.length > 0) return `${folder[folder.length - 1]} feature`
  return `${a.type || 'Asset'} #${a.id}`
}

// ── Route category classification (same rules as dashboard) ───────────────
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
const CATEGORY_LABELS: Record<string, string> = {
  owned: 'Owned', leased: 'Leased', waves: 'Waves', planned: 'Planned',
  pops: 'POPs', wirecenters: 'Wire Centers', colo: 'Co-Lo', datacenters: 'Data Centers',
  other: 'Other',
}
const CATEGORY_COLORS: Record<string, string> = {
  owned: '#2563EB', leased: '#F59E0B', waves: '#A855F7', planned: '#10B981',
  pops: '#EF4444', wirecenters: '#06B6D4', colo: '#F97316', datacenters: '#8B5CF6',
  other: '#64748B',
}

// Geometry family: Point/MultiPoint → 'point', Line*→'line', Polygon*→'polygon', else 'other'
type GeomFamily = 'point' | 'line' | 'polygon' | 'other'
const GEOM_LABELS: Record<GeomFamily, string> = {
  point: 'Points', line: 'Lines', polygon: 'Polygons', other: 'Others',
}
const GEOM_ICONS: Record<GeomFamily, string> = { point: '●', line: '▬', polygon: '▰', other: '◆' }
const GEOM_DOT: Record<GeomFamily, string> = {
  point: '#06b6d4', line: '#8b5cf6', polygon: '#10b981', other: '#94a3b8',
}
function geomFamily(type: string | null | undefined): GeomFamily {
  const t = (type || '').toLowerCase()
  if (t.includes('point')) return 'point'
  if (t.includes('line')) return 'line'
  if (t.includes('polygon')) return 'polygon'
  return 'other'
}
function classifyCategory(asset: Asset | FullAsset, datasetNameById: Map<number, string>): string {
  const folder = '_folder' in asset ? asset._folder : ((asset as any).properties?.__folder)
  const deepest = Array.isArray(folder) && folder.length > 0 ? folder[folder.length - 1] : null
  if (deepest) for (const r of AUTO_RULES) if (r.p.test(String(deepest))) return r.t
  const ds = asset.dataset_id != null ? datasetNameById.get(asset.dataset_id) : null
  if (ds) for (const r of AUTO_RULES) if (r.p.test(String(ds))) return r.t
  if (asset.name) for (const r of AUTO_RULES) if (r.p.test(String(asset.name))) return r.t
  return 'other'
}

type EditableField =
  | 'vendor_id' | 'status' | 'operational_status' | 'utilization_pct'
  | 'capacity_pct' | 'region' | 'installed_year' | 'cost_per_km'
  | 'total_cost' | 'length_km'

const FIELD_LABELS: Record<EditableField, string> = {
  vendor_id: 'Vendor', status: 'Status', operational_status: 'Op Status',
  utilization_pct: 'Util %', capacity_pct: 'Cap %', region: 'Region',
  installed_year: 'Year', cost_per_km: '$/km', total_cost: 'Total $',
  length_km: 'Length (km)',
}

const REQUIRED_FIELDS: EditableField[] = [
  'vendor_id', 'operational_status', 'utilization_pct', 'capacity_pct',
  'region', 'installed_year', 'cost_per_km', 'total_cost', 'length_km',
]

const STATUSES = ['active', 'planned', 'maintenance', 'decommissioned']
const OP_STATUSES = ['online', 'offline', 'warning']
const REGIONS = ['West', 'Southwest', 'Midwest', 'Southeast', 'Northeast']

function isMissing(a: Asset, f: EditableField): boolean {
  const v = a[f]
  return v === null || v === undefined || v === ''
}

function missingCount(a: Asset): number {
  return REQUIRED_FIELDS.filter(f => isMissing(a, f)).length
}

const PAGE_SIZE = 500

export default function FillAttributesPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [totalMissing, setTotalMissing] = useState<number>(0)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  // Global facet counts — pulled once across the full DB so filter dropdowns
  // show every option, not just what's in the currently-loaded rows.
  const [serverFacets, setServerFacets] = useState<{
    datasets: { value: number; count: number }[]
    types: { value: string; count: number }[]
    geometries: { value: string; count: number }[]
    groups: { value: string; count: number }[]
    facilities: { value: string; count: number }[]
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [edits, setEdits] = useState<Record<number, Partial<Asset>>>({})
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set())
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [focusField, setFocusField] = useState<EditableField | 'any'>('any')
  const [showLimit, setShowLimit] = useState(100)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detailAsset, setDetailAsset] = useState<FullAsset | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Client-side filters (applied to the current page of loaded rows)
  const [search, setSearch] = useState('')
  const [datasetFilter, setDatasetFilter] = useState<Set<number>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set())
  const [geomFilter, setGeomFilter] = useState<Set<GeomFamily>>(new Set())
  const [groupFilter, setGroupFilter] = useState<Set<string>>(new Set())
  const [facilityFilter, setFacilityFilter] = useState<Set<string>>(new Set())
  const [openFilter, setOpenFilter] = useState<'dataset' | 'category' | 'geom' | 'group' | 'facility' | null>(null)

  // Row selection for multi-view + bulk edit
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [multiViewOpen, setMultiViewOpen] = useState(false)
  const [bulkField, setBulkField] = useState<EditableField | ''>('')
  const [bulkValue, setBulkValue] = useState<string>('')
  const [bulkApplying, setBulkApplying] = useState(false)

  usePageLoading('fill-data', loading, 'Loading assets that need attention…')

  // Build server-side query string from the active filter state
  function buildFilterQs(offset: number): URLSearchParams {
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (focusField !== 'any') qs.set('field', focusField)
    if (search.trim()) qs.set('q', search.trim())
    if (datasetFilter.size > 0) qs.set('datasets', Array.from(datasetFilter).join(','))
    if (groupFilter.size > 0) qs.set('groups', Array.from(groupFilter).join(','))
    if (facilityFilter.size > 0) qs.set('facilities', Array.from(facilityFilter).join(','))
    if (geomFilter.size > 0) qs.set('geom', Array.from(geomFilter).join(','))
    return qs
  }

  // Refetch from the server whenever any filter changes. Debounced for search
  // so every keystroke doesn't slam the DB.
  useEffect(() => {
    let cancelled = false
    const debounce = setTimeout(async () => {
      setLoading(true)
      setAssets([])
      try {
        const qs = buildFilterQs(0)
        const [gaps, v, d, f] = await Promise.all([
          fetch(`/api/assets/gaps?${qs}`).then(r => r.json()),
          vendors.length === 0 ? fetch('/api/vendors').then(r => r.json()) : Promise.resolve(vendors),
          datasets.length === 0 ? fetch('/api/datasets').then(r => r.json()) : Promise.resolve(datasets),
          serverFacets ? Promise.resolve(null) : fetch('/api/assets/facets').then(r => r.json()),
        ])
        if (cancelled) return
        if (Array.isArray(gaps?.data)) {
          setAssets(gaps.data)
          setTotalMissing(gaps.total ?? gaps.data.length)
        }
        if (Array.isArray(v) && vendors.length === 0) setVendors(v)
        if (Array.isArray(d) && datasets.length === 0) setDatasets(d)
        if (f && !serverFacets) setServerFacets(f)
      } catch (e) { console.error(e) }
      if (!cancelled) setLoading(false)
    }, search.trim() ? 300 : 0)
    return () => { cancelled = true; clearTimeout(debounce) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField, search, datasetFilter, groupFilter, facilityFilter, geomFilter])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const qs = buildFilterQs(assets.length)
      const gaps = await fetch(`/api/assets/gaps?${qs}`).then(r => r.json())
      if (Array.isArray(gaps?.data)) {
        setAssets(prev => [...prev, ...gaps.data])
        if (gaps.total != null) setTotalMissing(gaps.total)
      }
    } catch (e) { console.error(e) }
    setLoadingMore(false)
  }

  // Lazy-fetch full asset (with geometry) when drawer opens
  useEffect(() => {
    if (detailId == null) { setDetailAsset(null); return }
    let cancelled = false
    setDetailLoading(true)
    fetch(`/api/assets/${detailId}`)
      .then(r => r.json())
      .then(a => { if (!cancelled && a && !a.error) setDetailAsset(a) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [detailId])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2500)
      return () => clearTimeout(t)
    }
  }, [toast])

  const vendorMap = useMemo(() => {
    const m = new Map<number, string>()
    for (const v of vendors) m.set(v.id, v.name)
    return m
  }, [vendors])

  const datasetMap = useMemo(() => {
    const m = new Map<number, Dataset>()
    for (const d of datasets) m.set(d.id, d)
    return m
  }, [datasets])

  const datasetNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const d of datasets) m.set(d.id, d.name)
    return m
  }, [datasets])

  // Server already applied search + dataset + group + facility + geom filters.
  // Only the "category" filter is computed client-side since it's derived from
  // folder/dataset name via regex (hard to express in SQL).
  const candidates = useMemo(() => {
    if (categoryFilter.size === 0) return assets
    return assets.filter(a => categoryFilter.has(classifyCategory(a, datasetNameById)))
  }, [assets, categoryFilter, datasetNameById])

  const missingTotals = useMemo(() => {
    const totals: Record<EditableField, number> = {} as any
    for (const f of REQUIRED_FIELDS) totals[f] = 0
    for (const a of assets) {
      for (const f of REQUIRED_FIELDS) if (isMissing(a, f)) totals[f]++
    }
    return totals
  }, [assets])
  const totalsApprox = focusField === 'any' && assets.length < totalMissing

  // Dropdown options come from the GLOBAL facets endpoint (every distinct
  // value across the whole assets table), not just currently-loaded rows.
  // Falls back to loaded rows while serverFacets is still fetching.
  const datasetOptions = useMemo(() => {
    const source = serverFacets?.datasets
    if (source && source.length > 0) {
      return source.map(d => ({ id: d.value as number, name: datasetNameById.get(d.value as number) || `#${d.value}`, count: d.count }))
    }
    const m = new Map<number, number>()
    for (const a of assets) if (a.dataset_id != null) m.set(a.dataset_id, (m.get(a.dataset_id) || 0) + 1)
    return Array.from(m.entries())
      .map(([id, count]) => ({ id, name: datasetNameById.get(id) || `#${id}`, count }))
      .sort((a, b) => b.count - a.count)
  }, [serverFacets, assets, datasetNameById])

  const categoryOptions = useMemo(() => {
    // Classification is derived from folder/dataset name — compute by scanning
    // all distinct folders globally (via serverFacets if available).
    const m = new Map<string, number>()
    for (const a of assets) {
      const cat = classifyCategory(a, datasetNameById)
      m.set(cat, (m.get(cat) || 0) + 1)
    }
    return Array.from(m.entries())
      .map(([k, count]) => ({ k, label: CATEGORY_LABELS[k] || k, count }))
      .sort((a, b) => b.count - a.count)
  }, [assets, datasetNameById])

  const geomOptions = useMemo(() => {
    const source = serverFacets?.geometries
    const order: GeomFamily[] = ['line', 'point', 'polygon', 'other']
    if (source && source.length > 0) {
      const m = new Map<string, number>(source.map(s => [String(s.value), s.count]))
      return order.filter(g => (m.get(g) || 0) > 0).map(g => ({ k: g, label: GEOM_LABELS[g], count: m.get(g) || 0 }))
    }
    const m = new Map<GeomFamily, number>()
    for (const a of assets) {
      const g = geomFamily(a.type)
      m.set(g, (m.get(g) || 0) + 1)
    }
    return order.filter(g => (m.get(g) || 0) > 0).map(g => ({ k: g, label: GEOM_LABELS[g], count: m.get(g) || 0 }))
  }, [serverFacets, assets])

  const groupOptions = useMemo(() => {
    const source = serverFacets?.groups
    if (source && source.length > 0) return source.map(s => ({ k: String(s.value), label: String(s.value), count: s.count }))
    const m = new Map<string, number>()
    for (const a of assets) if (a._group) m.set(a._group, (m.get(a._group) || 0) + 1)
    return Array.from(m.entries()).map(([k, c]) => ({ k, label: k, count: c })).sort((a, b) => b.count - a.count)
  }, [serverFacets, assets])

  const facilityOptions = useMemo(() => {
    const source = serverFacets?.facilities
    if (source && source.length > 0) return source.map(s => ({ k: String(s.value), label: String(s.value), count: s.count }))
    const m = new Map<string, number>()
    for (const a of assets) if (a._facility) m.set(a._facility, (m.get(a._facility) || 0) + 1)
    return Array.from(m.entries()).map(([k, c]) => ({ k, label: k, count: c })).sort((a, b) => b.count - a.count)
  }, [serverFacets, assets])

  function setField(id: number, field: EditableField, value: any) {
    setEdits(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value === '' ? null : value },
    }))
  }

  function valueFor(a: Asset, f: EditableField): any {
    if (edits[a.id] && f in edits[a.id]) return (edits[a.id] as any)[f]
    return a[f]
  }

  async function saveRow(id: number) {
    const payload = edits[id]
    if (!payload || Object.keys(payload).length === 0) return
    setSavingIds(s => new Set(s).add(id))
    try {
      // Auto-compute total_cost if both cost_per_km and length_km become set
      const merged = { ...assets.find(a => a.id === id), ...payload }
      const final: any = { ...payload }
      if (final.cost_per_km != null && merged && merged.length_km != null && final.total_cost == null) {
        final.total_cost = Number(final.cost_per_km) * Number(merged.length_km)
      }
      const res = await fetch(`/api/assets/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(final),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      // Merge updated fields back into local asset
      setAssets(prev => prev.map(a => a.id === id ? { ...a, ...json } : a))
      setEdits(prev => { const n = { ...prev }; delete n[id]; return n })
      setSavedIds(s => new Set(s).add(id))
      setTimeout(() => setSavedIds(s => { const n = new Set(s); n.delete(id); return n }), 1500)
    } catch (e: any) {
      setToast(`Save failed for #${id}: ${e.message}`)
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  async function saveAll() {
    const ids = Object.keys(edits).map(Number)
    if (ids.length === 0) return
    for (const id of ids) {
      // Serial so we don't swamp the DB with bulk UPDATEs
      // eslint-disable-next-line no-await-in-loop
      await saveRow(id)
    }
    setToast(`Saved ${ids.length} rows`)
  }

  function toggleSelect(id: number) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllVisible() {
    const visibleIds = candidates.slice(0, showLimit).map(a => a.id)
    const allSelected = visibleIds.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (allSelected) visibleIds.forEach(id => n.delete(id))
      else visibleIds.forEach(id => n.add(id))
      return n
    })
  }

  async function applyBulk() {
    if (!bulkField || bulkValue === '') return
    setBulkApplying(true)
    try {
      // Coerce bulkValue to correct type per field
      let value: any = bulkValue
      const numericFields = new Set<EditableField>(['utilization_pct', 'capacity_pct', 'installed_year', 'cost_per_km', 'total_cost', 'length_km', 'vendor_id'])
      if (numericFields.has(bulkField)) value = Number(bulkValue)

      const ids = Array.from(selectedIds)
      const payload: Partial<Asset> = { [bulkField]: value } as any

      // Serial — respect API pacing
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`/api/assets/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        if (res.ok) {
          const json = await res.json()
          setAssets(prev => prev.map(a => a.id === id ? { ...a, ...json } : a))
        }
      }
      setToast(`Applied ${FIELD_LABELS[bulkField]} to ${ids.length} rows`)
      setBulkField(''); setBulkValue('')
    } catch (e: any) {
      setToast(`Bulk apply failed: ${e.message}`)
    } finally {
      setBulkApplying(false)
    }
  }

  const dirtyCount = Object.keys(edits).length

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-gradient-to-br from-amber-50 via-white to-blue-50">
      <div className="max-w-[1600px] mx-auto px-5 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 bg-white/80 backdrop-blur border border-white rounded-xl shadow-sm px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight"
                  style={{ background: 'linear-gradient(90deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Fill Data Gaps
              </h1>
              <span className="text-[11px] text-slate-500">Tabular editor for missing attributes</span>
            </div>
            <div className="text-[11px] text-slate-600 mt-1">
              {loading ? 'Loading…' : (
                <>
                  <span className="font-semibold text-amber-700">{totalMissing.toLocaleString()}</span> assets need attention · showing <span className="font-semibold">{assets.length.toLocaleString()}</span>
                  {focusField !== 'any' && <span className="ml-1 text-slate-400">(filtered to missing <b className="text-slate-700">{FIELD_LABELS[focusField]}</b>)</span>}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/assets" className="px-3 py-1.5 rounded-md text-[11px] font-medium text-slate-600 hover:bg-slate-100">← All Assets</Link>
            <button
              onClick={saveAll}
              disabled={dirtyCount === 0}
              className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: dirtyCount > 0 ? 'linear-gradient(90deg, #10b981, #059669)' : '#94a3b8' }}
            >
              {dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'Save all'}
            </button>
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────── */}
        <div className="bg-white/80 backdrop-blur rounded-xl border border-white shadow-sm px-3 py-2 mb-3 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" /></svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or ID…"
              className="flex-1 bg-transparent text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <div className="w-px h-5 bg-slate-200" />
          <MultiSelectDropdown
            label="Dataset"
            open={openFilter === 'dataset'}
            onToggle={() => setOpenFilter(o => o === 'dataset' ? null : 'dataset')}
            selected={datasetFilter}
            onChange={setDatasetFilter}
            options={datasetOptions.map(o => ({ value: o.id, label: o.name, count: o.count }))}
          />
          <MultiSelectDropdown
            label="Type"
            open={openFilter === 'category'}
            onToggle={() => setOpenFilter(o => o === 'category' ? null : 'category')}
            selected={categoryFilter}
            onChange={setCategoryFilter}
            options={categoryOptions.map(o => ({ value: o.k, label: o.label, count: o.count, dot: CATEGORY_COLORS[o.k] }))}
          />
          <MultiSelectDropdown
            label="Geometry"
            open={openFilter === 'geom'}
            onToggle={() => setOpenFilter(o => o === 'geom' ? null : 'geom')}
            selected={geomFilter}
            onChange={setGeomFilter}
            options={geomOptions.map(o => ({ value: o.k, label: `${GEOM_ICONS[o.k]}  ${o.label}`, count: o.count, dot: GEOM_DOT[o.k] }))}
          />
          <MultiSelectDropdown
            label="Group"
            open={openFilter === 'group'}
            onToggle={() => setOpenFilter(o => o === 'group' ? null : 'group')}
            selected={groupFilter}
            onChange={setGroupFilter}
            options={groupOptions.map(o => ({ value: o.k, label: o.label, count: o.count, dot: '#0ea5e9' }))}
          />
          <MultiSelectDropdown
            label="Facility"
            open={openFilter === 'facility'}
            onToggle={() => setOpenFilter(o => o === 'facility' ? null : 'facility')}
            selected={facilityFilter}
            onChange={setFacilityFilter}
            options={facilityOptions.map(o => ({ value: o.k, label: o.label, count: o.count, dot: '#f97316' }))}
          />
          {(search || datasetFilter.size > 0 || categoryFilter.size > 0 || geomFilter.size > 0 || groupFilter.size > 0 || facilityFilter.size > 0) && (
            <button
              onClick={() => { setSearch(''); setDatasetFilter(new Set()); setCategoryFilter(new Set()); setGeomFilter(new Set()); setGroupFilter(new Set()); setFacilityFilter(new Set()) }}
              className="text-[10px] font-semibold text-slate-500 hover:text-slate-900 px-2 py-1 rounded"
            >Clear all</button>
          )}
          <div className="ml-auto text-[10px] text-slate-500 font-mono">
            {candidates.length.toLocaleString()} shown · {assets.length.toLocaleString()} loaded
          </div>
        </div>

        {/* ── Bulk action bar (appears when selections exist) ─────── */}
        {selectedIds.size > 0 && (
          <div className="mb-3 rounded-xl shadow-sm flex items-center gap-2 px-3 py-2 flex-wrap"
               style={{ background: 'linear-gradient(90deg, #dbeafe, #ede9fe)' }}>
            <span className="inline-flex items-center justify-center min-w-[22px] h-6 px-2 rounded-full bg-blue-600 text-white text-[11px] font-bold">
              {selectedIds.size}
            </span>
            <span className="text-[11px] font-semibold text-slate-800">selected</span>
            <div className="w-px h-5 bg-slate-300" />
            <button
              onClick={() => setMultiViewOpen(true)}
              className="px-3 py-1 rounded-md text-[11px] font-bold text-white shadow-sm"
              style={{ background: 'linear-gradient(90deg, #2563eb, #7c3aed)' }}
            >
              🗺 View all on map
            </button>
            <div className="w-px h-5 bg-slate-300" />
            <select
              value={bulkField}
              onChange={e => setBulkField(e.target.value as any)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
            >
              <option value="">— Apply value to all —</option>
              {REQUIRED_FIELDS.map(f => <option key={f} value={f}>Set {FIELD_LABELS[f]}</option>)}
            </select>
            {bulkField && <BulkValueInput field={bulkField} value={bulkValue} onChange={setBulkValue} vendors={vendors} />}
            {bulkField && (
              <button
                onClick={applyBulk}
                disabled={bulkApplying || bulkValue === ''}
                className="px-3 py-1 rounded-md text-[11px] font-bold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(90deg, #10b981, #059669)' }}
              >{bulkApplying ? 'Applying…' : `Apply to ${selectedIds.size}`}</button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-[10px] font-semibold text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-white"
            >Clear</button>
          </div>
        )}

        {/* Field focus chips */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mr-1">Focus field:</span>
          <button
            onClick={() => setFocusField('any')}
            className={`px-2.5 py-1 rounded-full font-semibold transition ${
              focusField === 'any' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Any ({totalMissing.toLocaleString()})
          </button>
          {REQUIRED_FIELDS.map(f => (
            <button
              key={f}
              onClick={() => setFocusField(f)}
              className={`px-2.5 py-1 rounded-full font-semibold transition ${
                focusField === f ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title={totalsApprox ? `≥ ${missingTotals[f]} in loaded rows — click to query the full count server-side` : undefined}
            >
              {FIELD_LABELS[f]} ({totalsApprox && focusField === 'any' ? `${missingTotals[f]}+` : missingTotals[f]})
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 sticky top-0 z-10">
                <tr className="text-[9px] uppercase tracking-wider text-slate-600">
                  <th className="px-2 py-2 text-center font-bold w-[32px]">
                    {(() => {
                      const visibleIds = candidates.slice(0, showLimit).map(a => a.id)
                      const allSel = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
                      return (
                        <input type="checkbox" checked={allSel} onChange={toggleAllVisible}
                               className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 cursor-pointer"
                               title="Select all visible" />
                      )
                    })()}
                  </th>
                  <th className="px-3 py-2 text-left font-bold w-[260px]">Asset / Source</th>
                  <th className="px-2 py-2 text-left font-bold w-[90px]">Type</th>
                  <th className="px-2 py-2 text-left font-bold">Vendor</th>
                  <th className="px-2 py-2 text-left font-bold">Status</th>
                  <th className="px-2 py-2 text-left font-bold">Op Status</th>
                  <th className="px-2 py-2 text-right font-bold">Util %</th>
                  <th className="px-2 py-2 text-right font-bold">Cap %</th>
                  <th className="px-2 py-2 text-left font-bold">Region</th>
                  <th className="px-2 py-2 text-right font-bold">Year</th>
                  <th className="px-2 py-2 text-right font-bold">$/km</th>
                  <th className="px-2 py-2 text-right font-bold">Total $</th>
                  <th className="px-2 py-2 text-right font-bold">Length km</th>
                  <th className="px-3 py-2 text-center font-bold w-[80px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={14} className="px-4 py-10 text-center text-slate-400">Loading assets…</td></tr>
                )}
                {!loading && candidates.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-12 text-center text-[13px]">
                      <div className="text-emerald-600 font-semibold">🎉 No missing data for this focus.</div>
                      <div className="text-slate-500 mt-1 text-[11px]">All assets under the current filter have their attributes set.</div>
                    </td>
                  </tr>
                )}
                {candidates.slice(0, showLimit).map(a => {
                  const dirty = edits[a.id] != null
                  const saving = savingIds.has(a.id)
                  const saved = savedIds.has(a.id)
                  const missing = missingCount(a)
                  const ds = a.dataset_id != null ? datasetMap.get(a.dataset_id) : null
                  const folder = folderPath(a)
                  const selected = detailId === a.id
                  const isChecked = selectedIds.has(a.id)
                  const category = classifyCategory(a, datasetNameById)
                  return (
                    <tr key={a.id} className={`border-t border-slate-100 ${isChecked ? 'bg-blue-50/80' : ''} ${dirty ? 'bg-blue-50/40' : ''} ${saved ? 'bg-emerald-50' : ''} ${selected ? 'bg-blue-100/60' : ''}`}>
                      <td className="px-2 py-1.5 align-middle text-center">
                        <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(a.id)}
                               className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 cursor-pointer" />
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <div className="flex items-start gap-1.5">
                          <button
                            onClick={() => setDetailId(a.id)}
                            className={`shrink-0 mt-0.5 w-5 h-5 rounded border text-[9px] font-bold flex items-center justify-center transition ${
                              selected ? 'bg-blue-600 text-white border-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-blue-50 hover:border-blue-300'
                            }`}
                            title="View on mini-map"
                          >👁</button>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-800 truncate max-w-[220px]">{displayName(a)}</div>
                            <div className="text-[9px] text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span className="font-mono">#{a.id}</span>
                              <span className="text-slate-300">·</span>
                              <span className="truncate inline-flex items-center gap-1">
                                <span style={{ color: GEOM_DOT[geomFamily(a.type)] }}>{GEOM_ICONS[geomFamily(a.type)]}</span>
                                {a.type}
                              </span>
                              {ds && <>
                                <span className="text-slate-300">·</span>
                                <span className="px-1 py-[1px] rounded bg-indigo-50 text-indigo-700 font-semibold truncate max-w-[120px]" title={ds.name}>📂 {ds.name}</span>
                              </>}
                              {folder && <span className="text-slate-500 italic truncate max-w-[140px]" title={folder}>{folder}</span>}
                              {a._group && <span className="px-1 py-[1px] rounded bg-sky-50 text-sky-700 font-semibold truncate max-w-[100px]" title={`Group: ${a._group}`}>🏷 {a._group}</span>}
                              {a._facility && <span className="px-1 py-[1px] rounded bg-orange-50 text-orange-700 font-semibold truncate max-w-[120px]" title={`Facility: ${a._facility}`}>🏢 {a._facility}</span>}
                              <span className="px-1 py-[1px] rounded bg-amber-100 text-amber-700 font-semibold">{missing} missing</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm"
                              style={{ background: CATEGORY_COLORS[category] || '#64748b' }}>
                          {CATEGORY_LABELS[category] || category}
                        </span>
                      </td>
                      <CellSelect a={a} field="vendor_id" value={valueFor(a, 'vendor_id')} missing={isMissing(a, 'vendor_id')}
                        onChange={v => setField(a.id, 'vendor_id', v === '' ? null : Number(v))}
                        options={[{ value: '', label: '—' }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]}
                        renderValue={(v) => v != null ? (vendorMap.get(Number(v)) || `#${v}`) : '—'} />
                      <CellSelect a={a} field="status" value={valueFor(a, 'status')} missing={isMissing(a, 'status')}
                        onChange={v => setField(a.id, 'status', v || null)}
                        options={[{ value: '', label: '—' }, ...STATUSES.map(s => ({ value: s, label: s }))]} />
                      <CellSelect a={a} field="operational_status" value={valueFor(a, 'operational_status')} missing={isMissing(a, 'operational_status')}
                        onChange={v => setField(a.id, 'operational_status', v || null)}
                        options={[{ value: '', label: '—' }, ...OP_STATUSES.map(s => ({ value: s, label: s }))]} />
                      <CellNumber a={a} field="utilization_pct" value={valueFor(a, 'utilization_pct')} missing={isMissing(a, 'utilization_pct')}
                        onChange={v => setField(a.id, 'utilization_pct', v)} min={0} max={100} step={0.1} />
                      <CellNumber a={a} field="capacity_pct" value={valueFor(a, 'capacity_pct')} missing={isMissing(a, 'capacity_pct')}
                        onChange={v => setField(a.id, 'capacity_pct', v)} min={0} max={100} step={0.1} />
                      <CellSelect a={a} field="region" value={valueFor(a, 'region')} missing={isMissing(a, 'region')}
                        onChange={v => setField(a.id, 'region', v || null)}
                        options={[{ value: '', label: '—' }, ...REGIONS.map(r => ({ value: r, label: r }))]} />
                      <CellNumber a={a} field="installed_year" value={valueFor(a, 'installed_year')} missing={isMissing(a, 'installed_year')}
                        onChange={v => setField(a.id, 'installed_year', v)} min={1900} max={2100} step={1} />
                      <CellNumber a={a} field="cost_per_km" value={valueFor(a, 'cost_per_km')} missing={isMissing(a, 'cost_per_km')}
                        onChange={v => setField(a.id, 'cost_per_km', v)} min={0} step={0.01} />
                      <CellNumber a={a} field="total_cost" value={valueFor(a, 'total_cost')} missing={isMissing(a, 'total_cost')}
                        onChange={v => setField(a.id, 'total_cost', v)} min={0} step={1} />
                      <CellNumber a={a} field="length_km" value={valueFor(a, 'length_km')} missing={isMissing(a, 'length_km')}
                        onChange={v => setField(a.id, 'length_km', v)} min={0} step={0.001} />
                      <td className="px-3 py-1.5 align-middle text-center">
                        <button
                          onClick={() => saveRow(a.id)}
                          disabled={!dirty || saving}
                          className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                            saved ? 'bg-emerald-100 text-emerald-800'
                              : dirty ? 'text-white shadow-sm'
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                          style={dirty && !saved ? { background: 'linear-gradient(135deg, #3b82f6, #6366f1)' } : undefined}
                        >
                          {saving ? '…' : saved ? '✓ Saved' : dirty ? 'Save' : 'No changes'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!loading && (candidates.length > showLimit || candidates.length < totalMissing) && (
            <div className="border-t border-slate-100 px-4 py-3 flex items-center justify-center gap-3 flex-wrap">
              <span className="text-[11px] text-slate-500">
                Showing {Math.min(showLimit, candidates.length).toLocaleString()} of {candidates.length.toLocaleString()}
                {candidates.length < totalMissing && <span className="ml-1 text-slate-400">· {totalMissing.toLocaleString()} total available</span>}
              </span>
              {candidates.length > showLimit && (
                <button
                  onClick={() => setShowLimit(n => n + 100)}
                  className="px-3 py-1 rounded text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
                >Show 100 more</button>
              )}
              {candidates.length < totalMissing && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-3 py-1 rounded text-[11px] font-semibold text-white shadow-sm disabled:opacity-50"
                  style={{ background: 'linear-gradient(90deg, #3b82f6, #6366f1)' }}
                >
                  {loadingMore ? 'Loading…' : `Load next ${PAGE_SIZE} from server`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 text-center text-[10px] text-slate-500">
          Edits are saved to the database via <code className="bg-white px-1 rounded border border-slate-200">PUT /api/assets/[id]</code>. Changes appear on the map and dashboard immediately.
        </div>

        {toast && (
          <div className="fixed bottom-4 right-4 bg-slate-900 text-white text-sm rounded-lg shadow-2xl px-4 py-2">
            {toast}
          </div>
        )}
      </div>

      {/* ── Detail drawer with mini-map ───────────────────────────────── */}
      {detailId != null && (
        <DetailDrawer
          assetId={detailId}
          asset={detailAsset}
          loading={detailLoading}
          dataset={detailAsset?.dataset_id != null ? datasetMap.get(detailAsset.dataset_id) || null : null}
          vendorName={detailAsset?.vendor_id != null ? vendorMap.get(detailAsset.vendor_id) || null : null}
          onClose={() => setDetailId(null)}
        />
      )}

      {/* ── Combined multi-feature map ───────────────────────────────── */}
      {multiViewOpen && selectedIds.size > 0 && (
        <MultiViewModal
          ids={Array.from(selectedIds)}
          datasetNameById={datasetNameById}
          vendors={vendors}
          onClose={() => setMultiViewOpen(false)}
        />
      )}
    </div>
  )
}

/* ── Detail drawer ───────────────────────────────────────────────────────── */

function DetailDrawer({ assetId, asset, loading, dataset, vendorName, onClose }: {
  assetId: number; asset: FullAsset | null; loading: boolean;
  dataset: Dataset | null; vendorName: string | null; onClose: () => void
}) {
  const folder = asset ? (Array.isArray(asset.properties?.__folder) ? asset.properties.__folder.join(' / ') : '') : ''
  const miniLayers = useMemo<GeoLayer[]>(() => {
    if (!asset?.geometry) return []
    const feature: GeoJSON.Feature = {
      type: 'Feature',
      geometry: asset.geometry,
      properties: { ...asset.properties, name: displayName(asset) },
    }
    return [{
      id: 'detail',
      name: displayName(asset),
      color: '#2563eb',
      visible: true,
      geojson: { type: 'FeatureCollection', features: [feature] },
      geomType: asset.geometry.type || 'Unknown',
      count: 1,
    }]
  }, [asset])

  const rawProps = useMemo(() => {
    const p = asset?.properties || {}
    return Object.entries(p)
      .filter(([k, v]) => !k.startsWith('_') && k !== 'styleUrl' && k !== 'fill' && k !== 'stroke'
                         && v != null && v !== '' && typeof v !== 'object')
      .slice(0, 18)
  }, [asset])

  const coordPreview = useMemo(() => {
    const g = asset?.geometry
    if (!g) return null
    const flatten = (c: any): number[][] => {
      if (!Array.isArray(c)) return []
      if (typeof c[0] === 'number') return [c]
      return c.flatMap(flatten)
    }
    const pts = g.coordinates ? flatten(g.coordinates) : []
    if (!pts.length) return null
    const lngs = pts.map(p => p[0]), lats = pts.map(p => p[1])
    return {
      count: pts.length,
      bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      first: pts[0], last: pts[pts.length - 1],
    }
  }, [asset])

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-[52px] right-0 bottom-0 w-[440px] max-w-[92vw] bg-white shadow-2xl z-50 border-l border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-indigo-50 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-blue-700 font-semibold">Asset preview</div>
            <div className="text-base font-bold text-slate-900 truncate">
              {asset ? displayName(asset) : `Loading asset #${assetId}…`}
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">#{assetId}{asset ? ` · ${asset.type}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Mini-map */}
          <div className="h-[240px] border-b border-slate-100 relative bg-slate-100">
            {loading ? (
              <div className="h-full flex items-center justify-center gap-2 text-xs text-slate-400">
                <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                Fetching geometry…
              </div>
            ) : miniLayers.length > 0 ? (
              <ArcGISMap layers={miniLayers} selectedFeature={miniLayers[0].geojson.features[0]} compact />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">No geometry to preview</div>
            )}
          </div>

          {/* Context */}
          <div className="p-4 space-y-3 text-[11px]">
            <InfoRow label="Dataset" value={
              dataset ? (
                <span className="flex flex-col">
                  <span className="font-semibold text-slate-900">📂 {dataset.name}</span>
                  {dataset.source_file && <span className="text-[10px] text-slate-500 font-mono truncate">{dataset.source_file}</span>}
                  <span className="text-[10px] text-slate-500">{dataset.feature_count?.toLocaleString()} features in dataset</span>
                </span>
              ) : <span className="text-slate-400">(none)</span>
            } />
            {folder && <InfoRow label="KML Folder" value={<span className="text-slate-700">{folder}</span>} />}
            <InfoRow label="Geometry" value={
              asset?.geometry && coordPreview ? (
                <span className="flex flex-col text-slate-700">
                  <span>{asset.geometry.type} · {coordPreview.count.toLocaleString()} vertices</span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {coordPreview.first[1].toFixed(4)}, {coordPreview.first[0].toFixed(4)}
                    {coordPreview.count > 1 && <> → {coordPreview.last[1].toFixed(4)}, {coordPreview.last[0].toFixed(4)}</>}
                  </span>
                </span>
              ) : <span className="text-slate-400">{loading ? '…' : '(no coordinates)'}</span>
            } />
            {vendorName && <InfoRow label="Vendor" value={<span className="text-slate-700">{vendorName}</span>} />}
            {asset?.length_km != null && <InfoRow label="Length" value={<span className="text-slate-700 tabular-nums">{Number(asset.length_km).toFixed(3)} km ({(Number(asset.length_km) * 0.621371).toFixed(2)} mi)</span>} />}

            {/* Raw properties from the source file */}
            {rawProps.length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Properties from source</div>
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <table className="w-full text-[10px]">
                    <tbody>
                      {rawProps.map(([k, v]) => (
                        <tr key={k} className="border-b last:border-0 border-slate-100">
                          <td className="px-2 py-1 text-[9px] uppercase tracking-wider text-slate-400 font-semibold bg-slate-50 w-[110px]">{k}</td>
                          <td className="px-2 py-1 text-slate-700 break-all">{String(v).slice(0, 120)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-100 px-4 py-2.5 flex items-center gap-2 bg-slate-50">
          <Link href={`/assets/${assetId}`} className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 no-underline">
            Open full editor →
          </Link>
          <Link href="/map" className="px-3 py-1.5 rounded-md text-[11px] font-medium text-slate-700 hover:bg-slate-200 no-underline">
            View on main map
          </Link>
        </div>
      </aside>
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">{label}</div>
      <div>{value}</div>
    </div>
  )
}

/* ── Cell components ─────────────────────────────────────────────────────── */

function cellClasses(missing: boolean): string {
  return `w-full px-1.5 py-1 rounded border text-[11px] tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 ${
    missing ? 'bg-amber-50 border-amber-300 text-slate-900 placeholder:text-amber-400' : 'bg-slate-50 border-slate-200 text-slate-700'
  }`
}

function CellSelect({ value, missing, onChange, options, renderValue }: {
  a: Asset; field: EditableField; value: any; missing: boolean;
  onChange: (v: string) => void; options: { value: string; label: string }[]; renderValue?: (v: any) => string
}) {
  return (
    <td className="px-2 py-1.5 align-middle">
      <select
        value={value == null ? '' : String(value)}
        onChange={e => onChange(e.target.value)}
        className={cellClasses(missing)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {!missing && renderValue && <div className="text-[9px] text-slate-400 mt-0.5 truncate">{renderValue(value)}</div>}
    </td>
  )
}

function CellNumber({ value, missing, onChange, min, max, step }: {
  a: Asset; field: EditableField; value: any; missing: boolean;
  onChange: (v: number | null) => void; min?: number; max?: number; step?: number
}) {
  return (
    <td className="px-2 py-1.5 align-middle">
      <input
        type="number"
        min={min} max={max} step={step}
        value={value == null ? '' : String(value)}
        onChange={e => {
          const raw = e.target.value
          onChange(raw === '' ? null : Number(raw))
        }}
        placeholder={missing ? '—' : ''}
        className={cellClasses(missing) + ' text-right'}
      />
    </td>
  )
}

/* ── Multi-select dropdown for filter bar ────────────────────────────────── */
function MultiSelectDropdown<T extends string | number>({ label, open, onToggle, selected, onChange, options }: {
  label: string; open: boolean; onToggle: () => void;
  selected: Set<T>; onChange: (s: Set<T>) => void;
  options: { value: T; label: string; count: number; dot?: string }[]
}) {
  const count = selected.size
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition ${
          count > 0 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        }`}
      >
        {label}
        {count > 0 && <span className="px-1 py-[1px] rounded bg-white/25 text-[9px] font-bold">{count}</span>}
        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-xl w-[240px] max-h-[320px] overflow-y-auto p-1.5 text-[11px]">
            {options.length === 0 && <div className="text-slate-400 text-center py-3">No options</div>}
            {options.map(o => {
              const isOn = selected.has(o.value)
              return (
                <label key={String(o.value)} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={isOn} onChange={() => {
                    const n = new Set(selected)
                    isOn ? n.delete(o.value) : n.add(o.value)
                    onChange(n)
                  }} className="rounded border-slate-300 text-blue-600" />
                  {o.dot && <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: o.dot }} />}
                  <span className="flex-1 truncate text-slate-700">{o.label}</span>
                  <span className="text-[9px] text-slate-400 font-mono tabular-nums">{o.count}</span>
                </label>
              )
            })}
            {selected.size > 0 && (
              <button
                onClick={() => onChange(new Set())}
                className="mt-1 w-full py-1 rounded text-[10px] font-semibold text-blue-600 hover:bg-blue-50"
              >Clear</button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Bulk value input — type aware ───────────────────────────────────────── */
function BulkValueInput({ field, value, onChange, vendors }: {
  field: EditableField; value: string; onChange: (v: string) => void; vendors: Vendor[]
}) {
  if (field === 'vendor_id') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]">
        <option value="">—</option>
        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    )
  }
  if (field === 'status') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]">
        <option value="">—</option>
        {['active','planned','maintenance','decommissioned'].map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }
  if (field === 'operational_status') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]">
        <option value="">—</option>
        {['online','offline','warning'].map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }
  if (field === 'region') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]">
        <option value="">—</option>
        {['West','Southwest','Midwest','Southeast','Northeast'].map(r => <option key={r} value={r}>{r}</option>)}
      </select>
    )
  }
  return (
    <input type="number" value={value} onChange={e => onChange(e.target.value)}
           placeholder="value"
           className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums" />
  )
}

/* ── Modal: visualise every selected feature on one map ──────────────────── */
interface MultiRow {
  id: number; name: string | null; type: string; geometry: any;
  dataset_id: number | null; vendor_id: number | null;
  status: string | null; operational_status: string | null;
  utilization_pct: number | null; capacity_pct: number | null;
  length_km: number | null; cost_per_km: number | null; total_cost: number | null;
  installed_year: number | null; region: string | null;
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

function MultiViewModal({ ids, datasetNameById, vendors, onClose }: {
  ids: number[]; datasetNameById: Map<number, string>;
  vendors?: Vendor[]; onClose: () => void
}) {
  const [rows, setRows] = useState<MultiRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/assets/geometries?ids=${ids.join(',')}`)
      .then(r => r.json())
      .then(j => { if (!cancelled && Array.isArray(j?.data)) setRows(j.data) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ids])

  const vendorNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const v of vendors || []) m.set(v.id, v.name)
    return m
  }, [vendors])

  // Per-feature unique colour from a 16-colour palette + a traversal path
  // connecting every selected point in order. Each feature carries its own
  // _color so ArcGISMap renders it distinctly. The path uses the first vertex
  // of each geometry so it works even when mixed point/line/polygon selections.
  const FEATURE_PALETTE = [
    '#2563eb', '#dc2626', '#16a34a', '#ea580c', '#9333ea', '#0891b2',
    '#be123c', '#ca8a04', '#7c3aed', '#059669', '#db2777', '#0ea5e9',
    '#e11d48', '#65a30d', '#6366f1', '#f97316',
  ]

  const firstCoord = (g: any): [number, number] | null => {
    if (!g?.coordinates) return null
    let c: any = g.coordinates
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const x = Number(c[0]), y = Number(c[1])
      if (!isNaN(x) && !isNaN(y)) return [x, y]
    }
    return null
  }

  type NumberedRow = MultiRow & { _color: string; _idx: number; _anchor: [number, number] | null; _category: string }
  const numbered = useMemo<NumberedRow[]>(() => rows.map((r, i) => ({
    ...r,
    _color: FEATURE_PALETTE[i % FEATURE_PALETTE.length],
    _idx: i + 1,
    _anchor: firstCoord(r.geometry),
    _category: classifyCategory(
      { id: r.id, dataset_id: r.dataset_id, name: r.name, type: r.type } as any,
      datasetNameById
    ),
  })), [rows, datasetNameById])

  const layers = useMemo<GeoLayer[]>(() => {
    if (numbered.length === 0) return []

    // 1. Each selected feature as its own coloured point/line/polygon
    const features: GeoJSON.Feature[] = numbered
      .filter(r => r.geometry)
      .map(r => ({
        type: 'Feature',
        geometry: r.geometry,
        properties: {
          name: `${r._idx}. ${r.name || `#${r.id}`}`,
          _color: r._color,
          _category: r._category,
        },
      }))

    // 2. A traversal path connecting every anchor vertex in order
    const anchorPath = numbered.map(r => r._anchor).filter(Boolean) as [number, number][]
    const pathLayer: GeoLayer | null = anchorPath.length >= 2 ? {
      id: 'path',
      name: 'Path A → B',
      color: '#64748b',
      visible: true,
      geojson: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: anchorPath },
          properties: { name: 'Traversal path', _color: '#94a3b8' },
        }],
      },
      geomType: 'LineString',
      count: 1,
    } : null

    return [
      // Path underneath
      ...(pathLayer ? [pathLayer] : []),
      // Features on top
      {
        id: 'features',
        name: 'Selected',
        color: '#3b82f6',
        visible: true,
        geojson: { type: 'FeatureCollection', features },
        geomType: features[0]?.geometry?.type || 'Unknown',
        count: features.length,
      },
    ]
  }, [numbered])

  // Cumulative stats across all selected rows
  const stats = useMemo(() => {
    const totalLengthKm = rows.reduce((s, r) => s + (Number(r.length_km) || 0), 0)
    const totalCost = rows.reduce((s, r) => s + (Number(r.total_cost) || 0), 0)
    const withLength = rows.filter(r => r.length_km != null).length
    const utilVals = rows.map(r => Number(r.utilization_pct)).filter(n => !isNaN(n))
    const capVals = rows.map(r => Number(r.capacity_pct)).filter(n => !isNaN(n))
    const avgUtil = utilVals.length ? utilVals.reduce((s, n) => s + n, 0) / utilVals.length : null
    const avgCap = capVals.length ? capVals.reduce((s, n) => s + n, 0) / capVals.length : null
    const totalLengthMi = totalLengthKm * 0.621371
    const avgCostPerMile = totalLengthMi > 0.01 ? totalCost / totalLengthMi : 0

    // Breakdowns
    const byOp = new Map<string, number>()
    const byCategory = new Map<string, { count: number; miles: number; cost: number }>()
    const byGeom = new Map<GeomFamily, number>()
    const byDataset = new Map<number | null, { count: number; miles: number; cost: number }>()
    const byVendor = new Map<number | null, { count: number; miles: number; cost: number }>()
    const byStatus = new Map<string, number>()

    let bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
    const extendBounds = (c: any) => {
      if (!Array.isArray(c)) return
      if (typeof c[0] === 'number') {
        const x = Number(c[0]), y = Number(c[1])
        if (!isNaN(x) && !isNaN(y)) {
          if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y
          if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y
        }
      } else c.forEach(extendBounds)
    }

    for (const r of rows) {
      const op = (r.operational_status || 'unknown').toLowerCase()
      byOp.set(op, (byOp.get(op) || 0) + 1)

      const cat = classifyCategory(
        { id: r.id, dataset_id: r.dataset_id, name: r.name, type: r.type } as any,
        datasetNameById
      )
      const c = byCategory.get(cat) || { count: 0, miles: 0, cost: 0 }
      c.count++
      c.miles += (Number(r.length_km) || 0) * 0.621371
      c.cost += Number(r.total_cost) || 0
      byCategory.set(cat, c)

      byGeom.set(geomFamily(r.type), (byGeom.get(geomFamily(r.type)) || 0) + 1)

      const dsKey = r.dataset_id
      const d = byDataset.get(dsKey) || { count: 0, miles: 0, cost: 0 }
      d.count++; d.miles += (Number(r.length_km) || 0) * 0.621371; d.cost += Number(r.total_cost) || 0
      byDataset.set(dsKey, d)

      const vKey = r.vendor_id
      const v = byVendor.get(vKey) || { count: 0, miles: 0, cost: 0 }
      v.count++; v.miles += (Number(r.length_km) || 0) * 0.621371; v.cost += Number(r.total_cost) || 0
      byVendor.set(vKey, v)

      const st = (r.status || 'unknown').toLowerCase()
      byStatus.set(st, (byStatus.get(st) || 0) + 1)

      if (r.geometry?.coordinates) extendBounds(r.geometry.coordinates)
    }

    return {
      totalLengthKm, totalLengthMi, totalCost, avgCostPerMile,
      withLength, withCost: rows.filter(r => r.total_cost != null).length,
      avgUtil, avgCap,
      byOp, byCategory, byGeom, byDataset, byVendor, byStatus,
      bbox: bbox[0] === Infinity ? null : bbox,
    }
  }, [rows, datasetNameById])

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 via-violet-50 to-pink-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🗺</span>
            <div>
              <div className="text-sm font-bold text-slate-900">{ids.length} selected asset{ids.length === 1 ? '' : 's'}</div>
              <div className="text-[10px] text-slate-500">
                {loading ? 'Fetching geometries…' : `${rows.length} rendered · ${layers.length} categor${layers.length === 1 ? 'y' : 'ies'}`}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
        </div>

        {/* Body: stats panel + map */}
        <div className="flex-1 flex overflow-hidden">
          {/* Stats sidebar */}
          <aside className="w-[320px] shrink-0 border-r border-slate-100 overflow-y-auto bg-slate-50/60">
            {loading ? (
              <div className="p-4 text-[11px] text-slate-400">Computing…</div>
            ) : (
              <div className="p-3 space-y-3 text-[11px]">
                {/* Headline totals */}
                <div className="grid grid-cols-2 gap-2">
                  <BigStat label="Total Length" value={`${fmtNum(stats.totalLengthMi)} mi`} sub={`${fmtNum(stats.totalLengthKm)} km`} accent="#3b82f6" />
                  <BigStat label="Total Cost" value={`$${fmtNum(stats.totalCost)}`} sub={`${stats.withCost} of ${rows.length} priced`} accent="#f59e0b" />
                  <BigStat label="Avg Cost/Mile" value={stats.avgCostPerMile ? `$${fmtNum(stats.avgCostPerMile)}` : '—'} sub="per route mile" accent="#ef4444" />
                  <BigStat label="With Length" value={`${stats.withLength}/${rows.length}`} sub={stats.withLength === rows.length ? 'complete' : 'some missing'} accent="#10b981" />
                </div>

                {stats.avgUtil != null && (
                  <div className="grid grid-cols-2 gap-2">
                    <BigStat label="Avg Utilization" value={`${stats.avgUtil.toFixed(1)}%`} sub="across selection" accent="#8b5cf6" />
                    <BigStat label="Avg Capacity" value={stats.avgCap != null ? `${stats.avgCap.toFixed(1)}%` : '—'} sub="across selection" accent="#06b6d4" />
                  </div>
                )}

                {/* Operational breakdown */}
                <BreakdownBlock title="Operational Status">
                  {Array.from(stats.byOp.entries()).map(([k, n]) => (
                    <BreakdownRow key={k} label={k}
                      dotColor={k === 'online' ? '#10b981' : k === 'offline' ? '#ef4444' : k === 'warning' ? '#f59e0b' : '#94a3b8'}
                      primary={`${n}`}
                      pct={rows.length ? (n / rows.length) * 100 : 0}
                    />
                  ))}
                </BreakdownBlock>

                {/* Category breakdown */}
                <BreakdownBlock title="By Type">
                  {Array.from(stats.byCategory.entries())
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([cat, v]) => (
                      <BreakdownRow key={cat} label={CATEGORY_LABELS[cat] || cat} dotColor={CATEGORY_COLORS[cat] || '#64748b'}
                        primary={`${v.count}`}
                        secondary={`${fmtNum(v.miles)} mi · $${fmtNum(v.cost)}`}
                        pct={rows.length ? (v.count / rows.length) * 100 : 0}
                      />
                  ))}
                </BreakdownBlock>

                {/* Geometry breakdown */}
                <BreakdownBlock title="Geometry">
                  {Array.from(stats.byGeom.entries()).map(([g, n]) => (
                    <BreakdownRow key={g} label={`${GEOM_ICONS[g]}  ${GEOM_LABELS[g]}`} dotColor={GEOM_DOT[g]}
                      primary={`${n}`} pct={rows.length ? (n / rows.length) * 100 : 0}
                    />
                  ))}
                </BreakdownBlock>

                {/* Dataset breakdown */}
                {stats.byDataset.size > 1 && (
                  <BreakdownBlock title="By Dataset">
                    {Array.from(stats.byDataset.entries())
                      .sort((a, b) => b[1].count - a[1].count)
                      .slice(0, 6)
                      .map(([id, v]) => (
                        <BreakdownRow key={String(id)} label={id != null ? (datasetNameById.get(id) || `#${id}`) : '(unassigned)'} dotColor="#6366f1"
                          primary={`${v.count}`}
                          secondary={`${fmtNum(v.miles)} mi · $${fmtNum(v.cost)}`}
                          pct={rows.length ? (v.count / rows.length) * 100 : 0}
                        />
                    ))}
                  </BreakdownBlock>
                )}

                {/* Vendor breakdown */}
                {stats.byVendor.size > 1 && (
                  <BreakdownBlock title="By Vendor">
                    {Array.from(stats.byVendor.entries())
                      .sort((a, b) => b[1].count - a[1].count)
                      .slice(0, 6)
                      .map(([id, v]) => (
                        <BreakdownRow key={String(id)} label={id != null ? (vendorNameById.get(id) || `#${id}`) : '(no vendor)'} dotColor={id != null ? '#0ea5e9' : '#94a3b8'}
                          primary={`${v.count}`}
                          secondary={`$${fmtNum(v.cost)}`}
                          pct={rows.length ? (v.count / rows.length) * 100 : 0}
                        />
                    ))}
                  </BreakdownBlock>
                )}

                {/* Bounding box */}
                {stats.bbox && (
                  <div className="rounded-md bg-white border border-slate-200 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Bounding box</div>
                    <div className="text-[10px] font-mono text-slate-700 leading-tight">
                      <div>N: {stats.bbox[3].toFixed(4)}°</div>
                      <div>S: {stats.bbox[1].toFixed(4)}°</div>
                      <div>E: {stats.bbox[2].toFixed(4)}°</div>
                      <div>W: {stats.bbox[0].toFixed(4)}°</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* Map */}
          <div className="flex-1 relative">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
                <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mr-2" />
                Loading {ids.length} geometries…
              </div>
            ) : layers.length > 0 ? (
              <ArcGISMap layers={layers} compact />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
                No geometries available for the selected assets.
              </div>
            )}

            {/* Legend overlay — per-feature when small selection, summary otherwise */}
            {layers.length > 0 && !loading && (
              <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-slate-200 px-3 py-2 max-w-[80%] max-h-[50%] overflow-y-auto">
                {numbered.length <= 20 ? (
                  <>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-1">Path A → B</div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      {numbered.map(r => (
                        <div key={r.id} className="flex items-center gap-1 text-[10px] font-semibold text-slate-700">
                          <span className="w-5 h-5 rounded-full text-white font-bold flex items-center justify-center text-[9px] shadow-sm" style={{ background: r._color }}>
                            {r._idx}
                          </span>
                          <span className="truncate max-w-[140px]" title={r.name || `#${r.id}`}>{r.name || `#${r.id}`}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-1">
                      {numbered.length} features · unique colours
                    </div>
                    <div className="text-[10px] text-slate-600">
                      Path connects anchors in selection order.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Small components for stats panel ────────────────────────────────────── */
function BigStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 p-2 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />
      <div className="pl-1.5">
        <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: accent }}>{label}</div>
        <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
        {sub && <div className="text-[9px] text-slate-500 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  )
}

function BreakdownBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 overflow-hidden">
      <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-500 font-bold bg-slate-50 border-b border-slate-100">
        {title}
      </div>
      <div className="p-1.5 space-y-1">{children}</div>
    </div>
  )
}

function BreakdownRow({ label, dotColor, primary, secondary, pct }: {
  label: string; dotColor: string; primary: string; secondary?: string; pct?: number
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: dotColor }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] text-slate-700 font-medium truncate capitalize">{label}</span>
          <span className="text-[10px] font-bold text-slate-900 tabular-nums shrink-0">{primary}</span>
        </div>
        {pct != null && (
          <div className="h-[3px] mt-0.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: dotColor }} />
          </div>
        )}
        {secondary && <div className="text-[9px] text-slate-500 tabular-nums mt-0.5 truncate">{secondary}</div>}
      </div>
    </div>
  )
}
