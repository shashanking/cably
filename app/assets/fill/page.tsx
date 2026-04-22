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

  usePageLoading('fill-data', loading, 'Loading assets that need attention…')

  // Reload slim rows whenever the focus-field filter changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setAssets([])
    ;(async () => {
      try {
        const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' })
        if (focusField !== 'any') qs.set('field', focusField)
        const [gaps, v, d] = await Promise.all([
          fetch(`/api/assets/gaps?${qs}`).then(r => r.json()),
          // Vendors + datasets only fetch once — cache via state check
          vendors.length === 0 ? fetch('/api/vendors').then(r => r.json()) : Promise.resolve(vendors),
          datasets.length === 0 ? fetch('/api/datasets').then(r => r.json()) : Promise.resolve(datasets),
        ])
        if (cancelled) return
        if (Array.isArray(gaps?.data)) {
          setAssets(gaps.data)
          setTotalMissing(gaps.total ?? gaps.data.length)
        }
        if (Array.isArray(v) && vendors.length === 0) setVendors(v)
        if (Array.isArray(d) && datasets.length === 0) setDatasets(d)
      } catch (e) { console.error(e) }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(assets.length) })
      if (focusField !== 'any') qs.set('field', focusField)
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

  // Server already filtered — local list IS the candidate list
  const candidates = assets

  // Per-field missing counts, computed from currently loaded rows.
  // Marked "approx" when we haven't loaded the whole missing set yet.
  const missingTotals = useMemo(() => {
    const totals: Record<EditableField, number> = {} as any
    for (const f of REQUIRED_FIELDS) totals[f] = 0
    for (const a of assets) {
      for (const f of REQUIRED_FIELDS) if (isMissing(a, f)) totals[f]++
    }
    return totals
  }, [assets])
  const totalsApprox = focusField === 'any' && assets.length < totalMissing

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
                  <th className="px-3 py-2 text-left font-bold w-[260px]">Asset / Source</th>
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
                  <tr><td colSpan={12} className="px-4 py-10 text-center text-slate-400">Loading assets…</td></tr>
                )}
                {!loading && candidates.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-[13px]">
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
                  return (
                    <tr key={a.id} className={`border-t border-slate-100 ${dirty ? 'bg-blue-50/40' : ''} ${saved ? 'bg-emerald-50' : ''} ${selected ? 'bg-blue-100/60' : ''}`}>
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
                              <span className="truncate">{a.type}</span>
                              {ds && <>
                                <span className="text-slate-300">·</span>
                                <span className="px-1 py-[1px] rounded bg-indigo-50 text-indigo-700 font-semibold truncate max-w-[120px]" title={ds.name}>📂 {ds.name}</span>
                              </>}
                              {folder && <span className="text-slate-500 italic truncate max-w-[140px]" title={folder}>{folder}</span>}
                              <span className="px-1 py-[1px] rounded bg-amber-100 text-amber-700 font-semibold">{missing} missing</span>
                            </div>
                          </div>
                        </div>
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
