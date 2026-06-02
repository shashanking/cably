'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'

interface Dataset {
  id: number
  name: string
  source_file: string | null
  feature_count: number
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null
  centroid: { lng: number; lat: number } | null
  created_at: string
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString()
}

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState('')
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/datasets', { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data)) setDatasets(data)
      else setError(data?.error || 'Failed to load datasets')
    } catch (err: any) {
      setError(err?.message || 'Failed to load datasets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const deleteOne = useCallback(async (ds: Dataset) => {
    const msg = `Delete "${ds.name}" and its ${ds.feature_count.toLocaleString()} feature${ds.feature_count === 1 ? '' : 's'}?\n\nThis cannot be undone.`
    if (!confirm(msg)) return
    setDeletingIds(prev => { const n = new Set(prev); n.add(ds.id); return n })
    try {
      const res = await fetch(`/api/datasets/${ds.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Delete failed')
      setDatasets(prev => prev.filter(d => d.id !== ds.id))
      setSelectedIds(prev => { const n = new Set(prev); n.delete(ds.id); return n })
      setToast({ msg: `Deleted "${ds.name}"`, kind: 'success' })
    } catch (err: any) {
      setToast({ msg: err?.message || 'Delete failed', kind: 'error' })
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(ds.id); return n })
    }
  }, [])

  const deleteSelected = useCallback(async () => {
    const targets = datasets.filter(d => selectedIds.has(d.id))
    if (targets.length === 0) return
    const totalFeats = targets.reduce((s, d) => s + d.feature_count, 0)
    const msg = `Delete ${targets.length} dataset${targets.length === 1 ? '' : 's'} and ${totalFeats.toLocaleString()} feature${totalFeats === 1 ? '' : 's'}?\n\nThis cannot be undone.`
    if (!confirm(msg)) return
    setDeletingIds(prev => { const n = new Set(prev); targets.forEach(t => n.add(t.id)); return n })
    let okCount = 0, failCount = 0
    await Promise.all(targets.map(async ds => {
      try {
        const res = await fetch(`/api/datasets/${ds.id}`, { method: 'DELETE' })
        if (!res.ok) { failCount += 1; return }
        okCount += 1
      } catch { failCount += 1 }
    }))
    await refresh()
    setSelectedIds(new Set())
    setDeletingIds(new Set())
    setToast({
      msg: failCount === 0
        ? `Deleted ${okCount} dataset${okCount === 1 ? '' : 's'}`
        : `Deleted ${okCount}, failed ${failCount}`,
      kind: failCount === 0 ? 'success' : 'error',
    })
  }, [datasets, selectedIds, refresh])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return datasets
    return datasets.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.source_file || '').toLowerCase().includes(q) ||
      String(d.id).includes(q),
    )
  }, [datasets, filter])

  const totals = useMemo(() => ({
    datasets: datasets.length,
    features: datasets.reduce((s, d) => s + d.feature_count, 0),
    selected: selectedIds.size,
    selectedFeatures: datasets.filter(d => selectedIds.has(d.id)).reduce((s, d) => s + d.feature_count, 0),
  }), [datasets, selectedIds])

  const allFilteredSelected = filtered.length > 0 && filtered.every(d => selectedIds.has(d.id))
  const toggleAll = () => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (allFilteredSelected) filtered.forEach(d => n.delete(d.id))
      else filtered.forEach(d => n.add(d.id))
      return n
    })
  }
  const toggleOne = (id: number) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto p-6">
        {toast && (
          <div className={`fixed top-16 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>{toast.msg}</div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Datasets</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Uploaded files become datasets. Deleting one removes its features from the map, dashboard, and assets list.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/upload"
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Upload
            </Link>
            <button
              onClick={refresh}
              disabled={loading}
              className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Refresh list"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Datasets</div>
            <div className="text-xl font-semibold text-slate-900 tabular-nums">{totals.datasets}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Total Features</div>
            <div className="text-xl font-semibold text-slate-900 tabular-nums">{formatCompact(totals.features)}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Selected</div>
            <div className="text-xl font-semibold text-slate-900 tabular-nums">
              {totals.selected}
              {totals.selected > 0 && (
                <span className="text-[11px] text-slate-400 font-normal ml-2">
                  ({formatCompact(totals.selectedFeatures)} features)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3 flex items-center gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              placeholder="Filter by name, source file, or id…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-blue-300"
            />
          </div>
          {selectedIds.size > 0 && (
            <button
              onClick={deleteSelected}
              disabled={deletingIds.size > 0}
              className="h-8 px-3 rounded-md text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-wait shadow-sm flex items-center gap-1.5"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
              Delete {selectedIds.size}
            </button>
          )}
        </div>

        {/* Table */}
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        ) : loading && datasets.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
            <div className="inline-flex items-center gap-2 text-sm text-slate-500">
              <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Loading datasets…
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
            <p className="text-sm text-slate-500 mb-1">
              {datasets.length === 0 ? 'No datasets uploaded yet.' : 'No datasets match the filter.'}
            </p>
            {datasets.length === 0 && (
              <Link href="/upload" className="inline-block mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">
                Upload your first dataset →
              </Link>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                  <th className="px-4 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      className="rounded border-slate-300"
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Source File</th>
                  <th className="px-4 py-2.5 text-right">Features</th>
                  <th className="px-4 py-2.5">Uploaded</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(ds => (
                  <tr key={ds.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(ds.id)}
                        onChange={() => toggleOne(ds.id)}
                        className="rounded border-slate-300"
                        aria-label={`Select ${ds.name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-800 font-medium truncate max-w-xs" title={ds.name}>{ds.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">#{ds.id}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono truncate max-w-xs" title={ds.source_file || ''}>
                      {ds.source_file || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-700 tabular-nums">
                      {ds.feature_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDate(ds.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteOne(ds)}
                        disabled={deletingIds.has(ds.id)}
                        className="text-[11px] text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 rounded px-2.5 py-1 font-semibold transition disabled:opacity-50 disabled:cursor-wait"
                      >
                        {deletingIds.has(ds.id) ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
