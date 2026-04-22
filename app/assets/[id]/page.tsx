'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Asset {
  id: number
  name: string | null
  type: string
  status: string | null
  geometry: any
  properties: Record<string, any> | null
  vendor_id: number | null
  vendor_name: string | null
  cost_per_km: number | null
  total_cost: number | null
  length_km: number | null
  operational_status: string | null
  utilization_pct: number | null
  capacity_pct: number | null
  region: string | null
  installed_year: number | null
  dataset_id: number | null
  created_at: string
  updated_at: string
}

const OPERATIONAL_STATUSES = ['online', 'offline', 'warning']
const REGIONS = ['West', 'Southwest', 'Midwest', 'Southeast', 'Northeast']

interface Vendor {
  id: number
  name: string
}

const ASSET_TYPES = [
  'Fiber Optic Cable',
  'Ethernet Cable',
  'Cable Structure',
  'Pole',
  'Tower',
  'Node',
  'Data Center',
  'POP',
]

const ASSET_STATUSES = ['active', 'planned', 'decommissioned', 'maintenance']

function formatCurrency(value: number | null) {
  if (value == null) return '--'
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id

  const [asset, setAsset] = useState<Asset | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Form state
  const [form, setForm] = useState({
    name: '',
    type: '',
    status: '',
    vendor_id: '',
    cost_per_km: '',
    total_cost: '',
    length_km: '',
    operational_status: '',
    utilization_pct: '',
    capacity_pct: '',
    region: '',
    installed_year: '',
  })

  const fetchAsset = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/assets/${id}`)
      if (!res.ok) throw new Error('Asset not found')
      const data = await res.json()
      setAsset(data)
      setForm({
        name: data.name ?? '',
        type: data.type ?? '',
        status: data.status ?? '',
        vendor_id: data.vendor_id != null ? String(data.vendor_id) : '',
        cost_per_km: data.cost_per_km != null ? String(data.cost_per_km) : '',
        total_cost: data.total_cost != null ? String(data.total_cost) : '',
        length_km: data.length_km != null ? String(data.length_km) : '',
        operational_status: data.operational_status ?? '',
        utilization_pct: data.utilization_pct != null ? String(data.utilization_pct) : '',
        capacity_pct: data.capacity_pct != null ? String(data.capacity_pct) : '',
        region: data.region ?? '',
        installed_year: data.installed_year != null ? String(data.installed_year) : '',
      })
    } catch (err) {
      console.error('Failed to fetch asset:', err)
      setFeedback({ type: 'error', message: 'Failed to load asset' })
    } finally {
      setLoading(false)
    }
  }, [id])

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch('/api/vendors')
      const data = await res.json()
      if (Array.isArray(data)) setVendors(data.map((v: any) => ({ id: v.id, name: v.name })))
    } catch (err) {
      console.error('Failed to fetch vendors:', err)
    }
  }, [])

  useEffect(() => {
    if (id) {
      fetchAsset()
      fetchVendors()
    }
  }, [id, fetchAsset, fetchVendors])

  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [feedback])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim() || null,
        type: form.type,
        status: form.status || null,
        vendor_id: form.vendor_id ? Number(form.vendor_id) : null,
        cost_per_km: form.cost_per_km ? Number(form.cost_per_km) : null,
        total_cost: form.total_cost ? Number(form.total_cost) : null,
        length_km: form.length_km ? Number(form.length_km) : null,
        operational_status: form.operational_status || null,
        utilization_pct: form.utilization_pct !== '' ? Number(form.utilization_pct) : null,
        capacity_pct: form.capacity_pct !== '' ? Number(form.capacity_pct) : null,
        region: form.region || null,
        installed_year: form.installed_year !== '' ? Number(form.installed_year) : null,
      }

      const res = await fetch(`/api/assets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update asset')
      }

      const updated = await res.json()
      setAsset(prev => prev ? { ...prev, ...updated } : prev)
      setFeedback({ type: 'success', message: 'Asset updated successfully' })
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save changes' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this asset? This action cannot be undone.')) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete asset')
      }
      router.push('/assets')
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to delete asset' })
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="h-[calc(100vh-52px)] flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">Loading asset...</span>
        </div>
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="h-[calc(100vh-52px)] flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <span className="text-4xl block mb-3 opacity-30">📡</span>
          <p className="text-sm text-slate-500 mb-3">Asset not found</p>
          <Link href="/assets" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            Back to Assets
          </Link>
        </div>
      </div>
    )
  }

  const properties = asset.properties || {}
  const propertyEntries = Object.entries(properties).filter(([k, v]) => !k.startsWith('_') && v != null && v !== '')

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-4xl p-6">
        {/* Feedback Toast */}
        {feedback && (
          <div className={`fixed top-16 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
            feedback.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {feedback.message}
          </div>
        )}

        {/* Back Link */}
        <Link
          href="/assets"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600 font-medium mb-4 no-underline transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Assets
        </Link>

        {/* Asset Header */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {asset.name || `Asset #${asset.id}`}
              </h1>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {asset.type}
                </span>
                {asset.status && (
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                    asset.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
                    asset.status === 'planned' ? 'bg-amber-50 text-amber-700' :
                    asset.status === 'decommissioned' ? 'bg-slate-100 text-slate-600' :
                    asset.status === 'maintenance' ? 'bg-blue-50 text-blue-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {asset.status}
                  </span>
                )}
                {asset.geometry?.type && (
                  <span className="text-xs text-slate-400">
                    {asset.geometry.type}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="h-8 px-3 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {deleting ? (
                <>
                  <div className="h-3 w-3 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  Delete
                </>
              )}
            </button>
          </div>
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSave}>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Edit Asset</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Name */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Asset name"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                >
                  <option value="">Select type...</option>
                  {ASSET_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                >
                  <option value="">Select status...</option>
                  {ASSET_STATUSES.map(s => (
                    <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>

              {/* Vendor */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Vendor</label>
                <select
                  value={form.vendor_id}
                  onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                >
                  <option value="">No vendor</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Cost Per KM */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Cost per km ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.cost_per_km}
                  onChange={e => setForm(f => ({ ...f, cost_per_km: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="0.00"
                />
              </div>

              {/* Total Cost */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Total Cost ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.total_cost}
                  onChange={e => setForm(f => ({ ...f, total_cost: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="0.00"
                />
              </div>

              {/* Length KM */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Length (km)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.length_km}
                  onChange={e => setForm(f => ({ ...f, length_km: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="0.000"
                />
              </div>

              {/* Operational Status */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Operational Status</label>
                <select
                  value={form.operational_status}
                  onChange={e => setForm(f => ({ ...f, operational_status: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">—</option>
                  {OPERATIONAL_STATUSES.map(s => (
                    <option key={s} value={s} className="capitalize">{s}</option>
                  ))}
                </select>
              </div>

              {/* Utilization % */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Utilization (%)</label>
                <input
                  type="number" step="0.1" min="0" max="100"
                  value={form.utilization_pct}
                  onChange={e => setForm(f => ({ ...f, utilization_pct: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="0 – 100"
                />
              </div>

              {/* Capacity % */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Capacity (%)</label>
                <input
                  type="number" step="0.1" min="0" max="100"
                  value={form.capacity_pct}
                  onChange={e => setForm(f => ({ ...f, capacity_pct: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="0 – 100"
                />
              </div>

              {/* Region */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Region</label>
                <select
                  value={form.region}
                  onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">—</option>
                  {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Installed Year */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Installed Year</label>
                <input
                  type="number" step="1" min="1900" max="2100"
                  value={form.installed_year}
                  onChange={e => setForm(f => ({ ...f, installed_year: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="e.g. 2022"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
              <Link
                href="/assets"
                className="h-9 px-4 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors no-underline flex items-center"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>

        {/* Properties */}
        {propertyEntries.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Properties</h2>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {propertyEntries.map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-3 py-1.5 border-b border-slate-50">
                  <span className="text-xs font-medium text-slate-400 w-32 shrink-0 truncate text-right">{key}</span>
                  <span className="text-xs text-slate-700 break-all">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Meta Info */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Metadata</h2>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-xs">
            <div className="flex items-baseline gap-3 py-1.5">
              <span className="font-medium text-slate-400 w-32 shrink-0 text-right">Asset ID</span>
              <span className="text-slate-700 font-mono">{asset.id}</span>
            </div>
            <div className="flex items-baseline gap-3 py-1.5">
              <span className="font-medium text-slate-400 w-32 shrink-0 text-right">Vendor</span>
              <span className="text-slate-700">{asset.vendor_name || '--'}</span>
            </div>
            <div className="flex items-baseline gap-3 py-1.5">
              <span className="font-medium text-slate-400 w-32 shrink-0 text-right">Total Cost</span>
              <span className="text-slate-700 font-mono">{formatCurrency(asset.total_cost)}</span>
            </div>
            <div className="flex items-baseline gap-3 py-1.5">
              <span className="font-medium text-slate-400 w-32 shrink-0 text-right">Geometry</span>
              <span className="text-slate-700">{asset.geometry?.type || '--'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
