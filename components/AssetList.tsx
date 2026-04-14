'use client'

import { useState, useEffect } from 'react'

interface Asset {
  id: number
  type: string
  geometry: any
  properties: any
}

interface AssetListProps {
  onSelectAsset: (asset: Asset) => void
  refreshTrigger?: number
}

const typeColors: Record<string, string> = {
  'Fiber Optic Cable': '#2563eb',
  'Ethernet Cable': '#16a34a',
  'Cable Structure': '#dc2626',
  'Pole': '#0ea5e9',
  'Tower': '#22c55e',
  'Node': '#eab308',
  'Data Center': '#8b5cf6',
}

export default function AssetList({ onSelectAsset, refreshTrigger }: AssetListProps) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/assets')
      .then(res => res.json())
      .then(data => setAssets(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to fetch assets:', err))
  }, [refreshTrigger])

  const filteredAssets = assets.filter(asset =>
    asset.properties?.name?.toLowerCase().includes(filter.toLowerCase()) ||
    asset.type.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div>
      <div className="relative mb-3">
        <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          placeholder="Filter assets..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 outline-none transition focus:border-blue-300 focus:ring-1 focus:ring-blue-200"
        />
      </div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-2 px-1">
        {filteredAssets.length} results
      </div>
      <div className="space-y-0.5">
        {filteredAssets.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">No assets found</p>
        )}
        {filteredAssets.map(asset => (
          <div
            key={asset.id}
            onClick={() => {
              setSelectedId(asset.id)
              onSelectAsset(asset)
            }}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 cursor-pointer transition ${
              selectedId === asset.id
                ? 'bg-blue-50 border border-blue-200'
                : 'border border-transparent hover:bg-slate-50'
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: typeColors[asset.type] || '#94a3b8' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-slate-800">{asset.properties?.name || `Asset ${asset.id}`}</div>
              <div className="truncate text-[11px] text-slate-400">{asset.type}</div>
            </div>
            <span className="text-[10px] text-slate-300">{asset.geometry.type}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
