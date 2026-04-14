'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import MapComponent, { Asset, Dataset } from '../components/MapComponent'
import {
  STYLE_MODES,
  StyleMode,
  computeStats,
  categoricalColor,
  ageColor,
  FALLBACK,
  getOwnerValue,
  getStatusValue,
  getPlacementValue,
  getInstallYear,
} from '../lib/styling'

export default function Home() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState<number | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [selectedAsset, setSelectedAsset] = useState<Asset | undefined>()
  const [showTable, setShowTable] = useState(true)
  const [styleMode, setStyleMode] = useState<StyleMode>('original')
  const [hiddenFolders, setHiddenFolders] = useState<Set<string>>(new Set())
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    fetch('/api/datasets')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setDatasets(data) })
      .catch(console.error)
  }, [refreshTrigger])

  useEffect(() => {
    if (!datasetId) { setAssets([]); return }
    const url = `/api/assets?dataset_id=${datasetId}`
    fetch(url)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setAssets(data) })
      .catch(console.error)
  }, [refreshTrigger, datasetId])

  const stats = useMemo(() => computeStats(assets), [assets])

  const visibleAssets = useMemo(() => {
    if (hiddenFolders.size === 0) return assets
    return assets.filter(a => {
      const folder = Array.isArray(a.properties?.__folder) ? a.properties.__folder[0] : null
      return !folder || !hiddenFolders.has(folder)
    })
  }, [assets, hiddenFolders])

  const visibleStats = useMemo(() => computeStats(visibleAssets), [visibleAssets])

  const toggleFolder = (f: string) => {
    setHiddenFolders(prev => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  const legend = useMemo(() => renderLegend(styleMode, visibleStats), [styleMode, visibleStats])

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-900">Cable Franchise Areas</h1>
          <span className="text-xs text-slate-400">|</span>
          <select
            value={datasetId ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setDatasetId(v === '' ? null : Number(v))
              setSelectedAsset(undefined)
              setHiddenFolders(new Set())
            }}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
          >
            <option value="">All datasets ({datasets.reduce((a, d) => a + d.feature_count, 0)})</option>
            {datasets.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.feature_count})</option>
            ))}
          </select>
          <span className="text-xs text-slate-500">{visibleAssets.length} features</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Style by</label>
          <select
            value={styleMode}
            onChange={(e) => setStyleMode(e.target.value as StyleMode)}
            disabled={!datasetId}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-400 focus:outline-none disabled:opacity-50"
          >
            {STYLE_MODES.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowTable(!showTable)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              showTable ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Layers
          </button>
          <button
            onClick={() => setRefreshTrigger(t => t + 1)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Legend */}
      {datasetId && legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Legend</span>
          {legend.map(item => (
            <div key={item.label} className="flex items-center gap-1.5 text-xs text-slate-600">
              {item.gradient ? (
                <span className="h-2.5 w-10 rounded-sm" style={{ background: item.gradient }} />
              ) : (
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
              )}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Map + side panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          <MapComponent
            assets={visibleAssets}
            datasets={datasets}
            selectedAsset={selectedAsset}
            onDatasetSelect={(id) => setDatasetId(id)}
            styleMode={styleMode}
            stats={visibleStats}
          />
        </div>

        {showTable && (
          <div className="w-[420px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
            {datasetId && stats.topFolders.length > 0 && (
              <div className="border-b border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Folders</span>
                  <button
                    onClick={() => setHiddenFolders(new Set())}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    Show all
                  </button>
                </div>
                <div className="max-h-48 space-y-1 overflow-auto">
                  {stats.topFolders.map(f => {
                    const count = assets.filter(a => a.properties?.__folder?.[0] === f).length
                    const checked = !hiddenFolders.has(f)
                    return (
                      <label key={f} className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFolder(f)}
                          className="h-3 w-3"
                        />
                        <span className="flex-1 truncate">{f}</span>
                        <span className="text-[10px] text-slate-400">{count}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="text-xs font-semibold text-slate-700">Feature Table</span>
              <div className="flex items-center gap-2">
                {expandedRows.size > 0 && (
                  <button
                    onClick={() => setExpandedRows(new Set())}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    Collapse all
                  </button>
                )}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{visibleAssets.length} rows</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="gis-table w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="w-6 px-2 py-2"></th>
                    <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Name</th>
                    <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Owner</th>
                    <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Status</th>
                    <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Placement</th>
                    <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Year</th>
                    <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Length</th>
                    <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Geom</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAssets.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                        {datasetId ? 'No features match filters.' : 'Select a dataset to drill in.'}
                      </td>
                    </tr>
                  )}
                  {visibleAssets.slice(0, 500).map(asset => {
                    const color = styleColorFor(asset, styleMode, visibleStats)
                    const p = asset.properties || {}
                    const expanded = expandedRows.has(asset.id)
                    const year = getInstallYear(p)
                    const length = (() => {
                      const raw = p.opticallength ?? p.sheathlength ?? p.calculated_length ?? p.MILEAGE
                      const n = typeof raw === 'number' ? raw : parseFloat(raw)
                      return Number.isFinite(n) ? n : null
                    })()
                    return (
                      <Fragment key={asset.id}>
                        <tr
                          onClick={() => setSelectedAsset(asset)}
                          className={`cursor-pointer border-b border-slate-100 transition-colors ${
                            selectedAsset?.id === asset.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-1 py-2 text-slate-400">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleRow(asset.id) }}
                              className="flex h-4 w-4 items-center justify-center rounded hover:bg-slate-200"
                              aria-label={expanded ? 'Collapse' : 'Expand'}
                            >
                              <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </td>
                          <td className="px-2 py-2 font-medium text-slate-800">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
                              <span className="truncate max-w-[120px]">{p.name || p.Name || `Asset ${asset.id}`}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-slate-600 truncate max-w-[100px]">{getOwnerValue(p) || '—'}</td>
                          <td className="px-2 py-2 text-slate-600 truncate max-w-[80px]">{getStatusValue(p) || '—'}</td>
                          <td className="px-2 py-2 text-slate-600 truncate max-w-[80px]">{getPlacementValue(p) || '—'}</td>
                          <td className="px-2 py-2 text-slate-500">{Number.isFinite(year) ? year : '—'}</td>
                          <td className="px-2 py-2 text-slate-500">{length != null ? length.toFixed(0) : '—'}</td>
                          <td className="px-2 py-2 text-slate-400">{asset.geometry?.type || '—'}</td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-slate-100 bg-slate-50/60">
                            <td></td>
                            <td colSpan={7} className="px-2 py-3">
                              <PropertyGrid properties={p} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {visibleAssets.length > 500 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-2 text-center text-[10px] text-slate-400">
                        Showing first 500 of {visibleAssets.length}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function styleColorFor(asset: Asset, mode: StyleMode, stats: ReturnType<typeof computeStats>): string {
  const p = asset.properties || {}
  switch (mode) {
    case 'original': return p.__color || FALLBACK
    case 'owner':    return categoricalColor(getOwnerValue(p))
    case 'status':   return categoricalColor(getStatusValue(p))
    case 'placement':return categoricalColor(getPlacementValue(p))
    case 'age':      return ageColor(getInstallYear(p), stats.yearMin, stats.yearMax)
    case 'length':   return categoricalColor(getOwnerValue(p))
  }
}

function PropertyGrid({ properties }: { properties: any }) {
  const entries = Object.entries(properties || {})
    .filter(([k, v]) =>
      !k.startsWith('__') &&
      k !== 'styleUrl' &&
      v != null &&
      v !== '' &&
      typeof v !== 'object',
    )
    .sort(([a], [b]) => a.localeCompare(b))

  const folder: string[] | null = Array.isArray(properties?.__folder) ? properties.__folder : null

  if (entries.length === 0 && !folder) {
    return <div className="text-[11px] text-slate-400">No additional properties</div>
  }

  return (
    <div>
      {folder && folder.length > 0 && (
        <div className="mb-2 flex items-center gap-1 text-[10px] text-slate-500">
          <span className="uppercase tracking-wider">Folder</span>
          <span className="text-slate-700">{folder.join(' / ')}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[11px]">
            <span className="shrink-0 text-slate-400 font-medium">{k}</span>
            <span className="text-slate-700 break-all">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

type LegendItem = { label: string; color?: string; gradient?: string }

function renderLegend(mode: StyleMode, stats: ReturnType<typeof computeStats>): LegendItem[] {
  const cap = (xs: string[], n = 10) => xs.slice(0, n)
  switch (mode) {
    case 'original':
      return []
    case 'owner':
      return cap(stats.owners).map(o => ({ label: o, color: categoricalColor(o) }))
    case 'status':
      return cap(stats.statuses).map(s => ({ label: s, color: categoricalColor(s) }))
    case 'placement':
      return cap(stats.placements).map(p => ({ label: p, color: categoricalColor(p) }))
    case 'age':
      if (stats.yearMin === 0 && stats.yearMax === 0) return []
      return [
        { label: `${stats.yearMin} → ${stats.yearMax}`, gradient: 'linear-gradient(to right, rgb(220,60,60), rgb(40,200,90))' },
      ]
    case 'length':
      if (stats.lengthMax === 0) return []
      return [
        { label: `length ${Math.round(stats.lengthMin)} → ${Math.round(stats.lengthMax)}`, color: '#64748b' },
      ]
  }
}
