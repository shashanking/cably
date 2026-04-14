'use client'

import { useState } from 'react'

interface AssetFormProps {
  onAssetAdded?: () => void
}

export default function AssetForm({ onAssetAdded }: AssetFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState('Pole')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const latitude = parseFloat(lat)
    const longitude = parseFloat(lng)

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setMessage('Enter valid latitude and longitude')
      setMessageType('error')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          properties: { name },
          geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          }
        })
      })
      const result = await res.json()
      if (res.ok) {
        setMessage('Asset created successfully')
        setMessageType('success')
        setName('')
        setLat('')
        setLng('')
        onAssetAdded?.()
      } else {
        setMessage(result.error || 'Failed to create asset')
        setMessageType('error')
      }
    } catch (error) {
      setMessage('Failed to create asset')
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:border-blue-300 focus:ring-1 focus:ring-blue-200"

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main St Junction" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            <option>Pole</option>
            <option>Tower</option>
            <option>Node</option>
            <option>Data Center</option>
            <option>Fiber Optic Cable</option>
            <option>Ethernet Cable</option>
            <option>Cable Structure</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Latitude</span>
          <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="40.7128" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Longitude</span>
          <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-74.0060" className={inputClass} />
        </label>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Add Asset'}
        </button>
        {message && (
          <p className={`text-xs ${messageType === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {message}
          </p>
        )}
      </div>
    </form>
  )
}
