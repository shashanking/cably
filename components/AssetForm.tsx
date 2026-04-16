'use client'

import { useState, useEffect } from 'react'

interface AssetFormProps { onAssetAdded?: () => void }
interface Vendor { id: number; name: string }

export default function AssetForm({ onAssetAdded }: AssetFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState('Pole')
  const [status, setStatus] = useState('active')
  const [vendorId, setVendorId] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [costPerKm, setCostPerKm] = useState('')
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/vendors').then(r => r.json()).then(d => { if (Array.isArray(d)) setVendors(d) }).catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const latitude = parseFloat(lat), longitude = parseFloat(lng)
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) { setMessage('Enter valid coordinates'); setMessageType('error'); return }
    setSaving(true); setMessage('')
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name || null,
          status,
          vendor_id: vendorId ? Number(vendorId) : null,
          cost_per_km: costPerKm ? Number(costPerKm) : null,
          properties: { name },
          geometry: { type: 'Point', coordinates: [longitude, latitude] },
        })
      })
      const result = await res.json()
      if (res.ok) {
        setMessage('Asset created successfully'); setMessageType('success')
        setName(''); setLat(''); setLng(''); setVendorId(''); setCostPerKm('')
        onAssetAdded?.()
      } else { setMessage(result.error || 'Failed'); setMessageType('error') }
    } catch { setMessage('Failed to create asset'); setMessageType('error') }
    finally { setSaving(false) }
  }

  const cls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:border-blue-300 focus:ring-1 focus:ring-blue-100"

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main St Junction" className={cls} />
          <span className="text-[10px] text-slate-400">Asset display name</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Type</span>
          <select value={type} onChange={e => setType(e.target.value)} className={cls}>
            <option>Pole</option><option>Tower</option><option>Node</option><option>Data Center</option>
            <option>POP</option><option>Fiber Optic Cable</option><option>Ethernet Cable</option><option>Cable Structure</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Latitude</span>
          <input value={lat} onChange={e => setLat(e.target.value)} placeholder="40.7128" className={cls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Longitude</span>
          <input value={lng} onChange={e => setLng(e.target.value)} placeholder="-74.0060" className={cls} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Status</span>
          <select value={status} onChange={e => setStatus(e.target.value)} className={cls}>
            <option value="active">Active</option><option value="planned">Planned</option>
            <option value="maintenance">Maintenance</option><option value="decommissioned">Decommissioned</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Vendor</span>
          <select value={vendorId} onChange={e => setVendorId(e.target.value)} className={cls}>
            <option value="">— None —</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <span className="text-[10px] text-slate-400">Add vendors in Vendor Management first</span>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Cost per km ($)</span>
          <input value={costPerKm} onChange={e => setCostPerKm(e.target.value)} placeholder="0.00" type="number" step="0.01" className={cls} />
        </label>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 shadow-sm">
          {saving ? 'Saving...' : 'Add Asset'}
        </button>
        {message && <p className={`text-xs ${messageType === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>{message}</p>}
      </div>
    </form>
  )
}
