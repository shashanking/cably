'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePageLoading } from '../../components/LoadingContext'

const PAGE_SIZE = 200

interface Asset {
  id: number
  dataset_id: number | null
  type: string
  name: string | null
  status: string | null
  vendor_id: number | null
  cost_per_km: number | null
  total_cost: number | null
  length_km: number | null
  geometry: any
  properties: any
  created_at: string
}

interface Vendor { id: number; name: string }

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkVendor, setBulkVendor] = useState<string>('')
  const [bulkStatus, setBulkStatus] = useState<string>('')
  const [bulkApplying, setBulkApplying] = useState(false)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  usePageLoading('assets-list', loading, 'Loading assets…')

  const loadPage = useCallback(async (offset: number, replace = false) => {
    const res = await fetch(`/api/assets?limit=${PAGE_SIZE}&offset=${offset}${offset === 0 ? '&count=true' : ''}`)
    const json = await res.json()
    const rows: Asset[] = Array.isArray(json) ? json : (json?.data || [])
    if (offset === 0 && typeof json?.total === 'number') setTotal(json.total)
    setAssets(prev => replace ? rows : [...prev, ...rows])
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [, v] = await Promise.all([
          loadPage(0, true),
          fetch('/api/vendors').then(r => r.json()).catch(() => []),
        ])
        if (mounted && Array.isArray(v)) setVendors(v)
      } catch (e) { console.error(e) }
      finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
  }, [loadPage])

  const loadMore = async () => {
    setLoadingMore(true)
    try { await loadPage(assets.length, false) } catch (e) { console.error(e) }
    setLoadingMore(false)
  }

  const loadAll = async () => {
    setLoadingMore(true)
    try {
      // Fetch in parallel pages of 1000 for speed
      const CHUNK = 1000
      const remaining = Math.max(0, total - assets.length)
      if (remaining === 0) { setLoadingMore(false); return }
      const startOffsets: number[] = []
      for (let off = assets.length; off < total; off += CHUNK) startOffsets.push(off)
      const pages = await Promise.all(startOffsets.map(async off => {
        const res = await fetch(`/api/assets?limit=${CHUNK}&offset=${off}`)
        const json = await res.json()
        return (Array.isArray(json) ? json : json?.data || []) as Asset[]
      }))
      const flat = pages.flat()
      setAssets(prev => [...prev, ...flat])
    } catch (e) { console.error(e) }
    setLoadingMore(false)
  }

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const types = [...new Set(assets.map(a => a.type).filter(Boolean))].sort()
  const statuses = [...new Set(assets.map(a => a.status || 'active').filter(Boolean))].sort()
  const vendorNames = vendors.map(v => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name))

  const filtered = assets.filter(a => {
    const name = a.name || a.properties?.name || a.properties?.Name || ''
    if (filter && !name.toLowerCase().includes(filter.toLowerCase()) && !a.type.toLowerCase().includes(filter.toLowerCase())) return false
    if (typeFilter && a.type !== typeFilter) return false
    if (statusFilter && (a.status || 'active') !== statusFilter) return false
    if (vendorFilter && String(a.vendor_id) !== vendorFilter) return false
    return true
  })

  const totalCost = filtered.reduce((sum, a) => sum + (Number(a.total_cost) || 0), 0)

  const toggleRow = (id: number) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleAll = (ids: number[]) => {
    const allSelected = ids.every(id => selected.has(id))
    setSelected(prev => {
      const s = new Set(prev)
      if (allSelected) ids.forEach(id => s.delete(id))
      else ids.forEach(id => s.add(id))
      return s
    })
  }
  const clearSelection = () => setSelected(new Set())

  const applyBulk = async () => {
    if (selected.size === 0) return
    const payload: any = { ids: [...selected] }
    if (bulkVendor !== '') payload.vendor_id = bulkVendor === '__none__' ? null : Number(bulkVendor)
    if (bulkStatus !== '') payload.status = bulkStatus
    if (!('vendor_id' in payload) && !('status' in payload)) { setToast('Choose a vendor or status to apply'); return }
    setBulkApplying(true)
    try {
      const res = await fetch('/api/assets/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Bulk update failed')
      setAssets(prev => prev.map(a => selected.has(a.id) ? {
        ...a,
        vendor_id: 'vendor_id' in payload ? payload.vendor_id : a.vendor_id,
        status: 'status' in payload ? payload.status : a.status,
      } : a))
      setToast(`Updated ${data.updated ?? selected.size} asset${selected.size !== 1 ? 's' : ''}`)
      clearSelection()
      setBulkVendor(''); setBulkStatus('')
    } catch (e: any) {
      setToast(e.message || 'Bulk update failed')
    }
    setBulkApplying(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this asset permanently?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setAssets(prev => prev.filter(a => a.id !== id))
        setToast('Asset deleted successfully')
      }
    } catch (e) { console.error(e) }
    setDeleting(null)
  }

  const vendorName = (id: number | null) => vendors.find(v => v.id === id)?.name || null
  const statusColor = (s: string) => {
    if (s === 'active') return 'bg-emerald-50 text-emerald-700'
    if (s === 'planned') return 'bg-amber-50 text-amber-700'
    if (s === 'decommissioned') return 'bg-slate-100 text-slate-500'
    if (s === 'maintenance') return 'bg-blue-50 text-blue-700'
    return 'bg-slate-50 text-slate-600'
  }

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Assets</h1>
            <p className="text-sm text-slate-500 mt-0.5" title="Browse, filter, and manage all network assets. Click Edit to modify asset details, assign vendors, and set costs.">
              {filtered.length} of {assets.length} assets — Browse, filter, and manage all network assets. Click Edit to modify asset details, assign vendors, and set costs.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/assets/fill" className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white hover:from-amber-600 hover:to-orange-600 shadow-sm no-underline">
              ⚠ Fill Data Gaps
            </Link>
            <Link href="/map" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm no-underline">
              View on Map
            </Link>
            <Link href="/upload" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 shadow-sm no-underline">+ Add Asset</Link>
          </div>
        </div>

        {/* Pro tip info box */}
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          💡 Pro tip: Use the Type and Status filters to narrow down assets. Click Edit to assign vendors and set cost data. Costs are automatically calculated based on cost per km × route length.
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search by name or type..." className="flex-1 min-w-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300 shadow-sm" />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300 shadow-sm">
            <option value="">All Types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300 shadow-sm">
            <option value="">All Statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300 shadow-sm">
            <option value="">All Vendors</option>
            {vendorNames.map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
          </select>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mb-4 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 flex items-center gap-3 flex-wrap shadow-sm">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-[11px] font-bold">{selected.size}</span>
              <span className="text-sm font-medium text-blue-900">selected</span>
            </div>
            <div className="w-px h-6 bg-blue-200" />
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-blue-900 uppercase tracking-wider">Vendor</label>
              <select value={bulkVendor} onChange={e => setBulkVendor(e.target.value)} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400">
                <option value="">— no change —</option>
                <option value="__none__">Unassign</option>
                {vendorNames.map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-blue-900 uppercase tracking-wider">Status</label>
              <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400">
                <option value="">— no change —</option>
                {['active', 'planned', 'maintenance', 'decommissioned'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={applyBulk} disabled={bulkApplying || (bulkVendor === '' && bulkStatus === '')} className="ml-auto h-8 px-4 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {bulkApplying && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {bulkApplying ? 'Applying…' : `Apply to ${selected.size}`}
            </button>
            <button onClick={clearSelection} className="h-8 px-3 rounded-md border border-blue-200 bg-white text-xs font-medium text-blue-700 hover:bg-blue-50">Clear</button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left w-10">
                    {(() => {
                      const visibleIds = filtered.map(a => a.id)
                      const allSel = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
                      return (
                        <input
                          type="checkbox"
                          checked={allSel}
                          onChange={() => toggleAll(visibleIds)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400 cursor-pointer"
                          title="Select all currently shown"
                        />
                      )
                    })()}
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" title="Display name of the network asset">Name</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" title="Asset category such as fiber, conduit, splice point, etc.">Type</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" title="Current operational status: active = operational, planned = under design, decommissioned = retired, maintenance = under repair">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" title="Vendor or supplier assigned to this asset. Click the vendor name to manage vendors.">Vendor</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" title="GeoJSON geometry type (Point, LineString, Polygon, etc.)">Geometry</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" title="Route length in kilometers, calculated from geometry">Length (km)</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" title="Total cost in USD, calculated as cost per km multiplied by route length">Cost</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" title="Edit or delete this asset">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center">
                      <p className="text-slate-400 mb-2">No assets found.</p>
                      <p className="text-sm text-slate-400">
                        Upload network data files (KML/KMZ) on the{' '}
                        <Link href="/upload" className="text-blue-600 hover:underline">Upload page</Link>
                        , or add assets manually.
                      </p>
                    </td>
                  </tr>
                )}
                {filtered.map(a => {
                  const name = a.name || a.properties?.name || a.properties?.Name || `Asset #${a.id}`
                  const status = a.status || 'active'
                  const vName = vendorName(a.vendor_id)
                  const isSel = selected.has(a.id)
                  return (
                    <tr key={a.id} className={`border-b border-slate-100 transition-colors ${isSel ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleRow(a.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{name}</td>
                      <td className="px-4 py-3 text-slate-600">{a.type}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor(status)}`}
                          title={
                            status === 'active' ? 'Operational'
                            : status === 'planned' ? 'Under design'
                            : status === 'decommissioned' ? 'Retired'
                            : status === 'maintenance' ? 'Under repair'
                            : status
                          }
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {vName ? (
                          <Link href="/vendors" className="text-blue-600 hover:underline no-underline">{vName}</Link>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs">{a.geometry?.type || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono">{a.length_km ? Number(a.length_km).toFixed(2) : '—'}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono">{a.total_cost ? `$${Number(a.total_cost).toLocaleString()}` : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <Link href={`/assets/${a.id}`} className="px-2 py-1 rounded-md text-xs font-medium text-blue-600 hover:bg-blue-50 no-underline">Edit →</Link>
                          <button onClick={() => handleDelete(a.id)} disabled={deleting === a.id} className="px-2 py-1 rounded-md text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50">Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer: pagination + totals */}
          {!loading && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap gap-3 justify-between items-center">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span>
                  Showing <span className="font-semibold text-slate-700">{filtered.length.toLocaleString()}</span>
                  {total > 0 && assets.length < total && <> · loaded {assets.length.toLocaleString()} of {total.toLocaleString()}</>}
                </span>
                {assets.length < total && (
                  <>
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="h-7 px-3 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {loadingMore && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {loadingMore ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, total - assets.length)} more`}
                    </button>
                    <button
                      onClick={loadAll}
                      disabled={loadingMore}
                      className="h-7 px-3 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      title="Fetch all remaining assets in parallel"
                    >
                      Load all ({(total - assets.length).toLocaleString()})
                    </button>
                  </>
                )}
              </div>
              <span className="text-sm font-semibold text-slate-700">
                Total Cost: <span className="font-mono">${totalCost.toLocaleString()}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg animate-[fadeIn_0.2s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  )
}
