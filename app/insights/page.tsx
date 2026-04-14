'use client'

import { useEffect, useMemo, useState } from 'react'

interface Asset {
  id: number
  type: string
  geometry: any
  properties: any
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

interface Dataset {
  id: number
  name: string
  source_file: string | null
  feature_count: number
}

export default function InsightsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/datasets')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setDatasets(data) })
      .catch(console.error)
  }, [])

  useEffect(() => {
    const url = datasetId ? `/api/assets?dataset_id=${datasetId}` : '/api/assets'
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setAssets(data)
        }
      })
      .catch(console.error)
  }, [datasetId])

  const metrics = useMemo(() => {
    const counts = assets.reduce(
      (acc, asset) => {
        acc.total += 1
        acc.byType[asset.type] = (acc.byType[asset.type] || 0) + 1
        acc.byGeometry[asset.geometry.type] = (acc.byGeometry[asset.geometry.type] || 0) + 1
        return acc
      },
      { total: 0, byType: {} as Record<string, number>, byGeometry: {} as Record<string, number> }
    )
    return counts
  }, [assets])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Network Insights</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Asset distribution and geometry breakdown across your telecom network.
          </p>
        </div>
        <select
          value={datasetId ?? ''}
          onChange={(e) => setDatasetId(e.target.value === '' ? null : Number(e.target.value))}
          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
        >
          <option value="">All datasets</option>
          {datasets.map(d => (
            <option key={d.id} value={d.id}>{d.name} ({d.feature_count})</option>
          ))}
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Assets</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{metrics.total}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Asset Types</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{Object.keys(metrics.byType).length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Geometry Types</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{Object.keys(metrics.byGeometry).length}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By type */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">Distribution by Type</h2>
          {Object.keys(metrics.byType).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No data yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(metrics.byType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const pct = metrics.total > 0 ? (count / metrics.total) * 100 : 0
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: typeColors[type] || '#94a3b8' }} />
                          <span className="text-sm text-slate-700">{type}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">{pct.toFixed(0)}%</span>
                          <span className="text-sm font-semibold text-slate-900 w-8 text-right">{count}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: typeColors[type] || '#94a3b8' }}
                        />
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        {/* By geometry */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">Distribution by Geometry</h2>
          {Object.keys(metrics.byGeometry).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No data yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(metrics.byGeometry)
                .sort(([, a], [, b]) => b - a)
                .map(([geometry, count]) => {
                  const pct = metrics.total > 0 ? (count / metrics.total) * 100 : 0
                  const color = geometry === 'Point' ? '#eab308' : geometry === 'LineString' ? '#2563eb' : '#dc2626'
                  return (
                    <div key={geometry}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                          <span className="text-sm text-slate-700">{geometry}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">{pct.toFixed(0)}%</span>
                          <span className="text-sm font-semibold text-slate-900 w-8 text-right">{count}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
