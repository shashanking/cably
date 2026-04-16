'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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

  useEffect(() => {
    Promise.all([
      fetch('/api/assets').then(r => r.json()),
      fetch('/api/vendors').then(r => r.json()),
    ]).then(([a, v]) => {
      if (Array.isArray(a)) setAssets(a)
      if (Array.isArray(v)) setVendors(v)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

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
            <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm no-underline">
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

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
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
                {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center">
                      <p className="text-slate-400 mb-2">No assets found.</p>
                      <p className="text-sm text-slate-400">
                        Upload network data files (KML/KMZ) on the{' '}
                        <Link href="/upload" className="text-blue-600 hover:underline">Upload page</Link>
                        , or add assets manually.
                      </p>
                    </td>
                  </tr>
                )}
                {filtered.slice(0, 200).map(a => {
                  const name = a.name || a.properties?.name || a.properties?.Name || `Asset #${a.id}`
                  const status = a.status || 'active'
                  const vName = vendorName(a.vendor_id)
                  return (
                    <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
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
                {filtered.length > 200 && <tr><td colSpan={8} className="px-4 py-2 text-center text-[10px] text-slate-400">Showing 200 of {filtered.length}</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Total cost summary */}
          {!loading && filtered.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex justify-between items-center">
              <span className="text-sm text-slate-500">{filtered.length} asset{filtered.length !== 1 ? 's' : ''} shown</span>
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
