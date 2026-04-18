'use client'

import { useEffect, useState } from 'react'

export type LoadStage =
  | 'idle'
  | 'connecting'
  | 'fetching'
  | 'parsing'
  | 'projecting'
  | 'rendering'
  | 'done'

export interface LoadState {
  stage: LoadStage
  datasetsTotal: number
  datasetsDone: number
  featuresTotal: number
  featuresPlotted: number
  attrsIndexed: number
  currentLabel?: string
}

const STAGES: { id: LoadStage; label: string; desc: string }[] = [
  { id: 'connecting', label: 'Link', desc: 'Establishing geospatial link' },
  { id: 'fetching', label: 'Fetch', desc: 'Streaming asset records' },
  { id: 'parsing', label: 'Index', desc: 'Indexing attributes' },
  { id: 'projecting', label: 'Project', desc: 'Projecting geometries (WGS84)' },
  { id: 'rendering', label: 'Render', desc: 'Rasterizing on canvas' },
]

function stageIndex(s: LoadStage) {
  const i = STAGES.findIndex(st => st.id === s)
  return i === -1 ? (s === 'done' ? STAGES.length : 0) : i
}

export default function MapLoadingOverlay({ state, onDismiss }: { state: LoadState; onDismiss?: () => void }) {
  const [visible, setVisible] = useState(state.stage !== 'idle')
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (state.stage !== 'idle' && state.stage !== 'done') {
      setVisible(true)
      setClosing(false)
    }
    if (state.stage === 'done') {
      const t1 = setTimeout(() => setClosing(true), 600)
      const t2 = setTimeout(() => { setVisible(false); onDismiss?.() }, 1100)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
  }, [state.stage, onDismiss])

  if (!visible) return null

  const currentIdx = stageIndex(state.stage)
  const overallPct = state.featuresTotal > 0
    ? Math.min(100, Math.round((state.featuresPlotted / state.featuresTotal) * 100))
    : Math.min(95, (currentIdx / STAGES.length) * 100)

  return (
    <div className={`absolute inset-0 z-[950] pointer-events-auto flex items-center justify-center transition-opacity duration-500 ${closing ? 'opacity-0' : 'opacity-100'}`}>
      {/* Backdrop with subtle grid */}
      <div className="absolute inset-0 bg-[#0b1220]/80 backdrop-blur-md">
        <div className="absolute inset-0 opacity-[0.08]" style={{
          backgroundImage: 'linear-gradient(rgba(96,165,250,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,.4) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />
        {/* Scan line */}
        <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400/70 to-transparent animate-[scanline_2.4s_linear_infinite]" style={{ top: '30%', boxShadow: '0 0 14px 2px rgba(59,130,246,.35)' }} />
      </div>

      {/* Panel */}
      <div className="relative w-[460px] max-w-[92vw] rounded-2xl border border-white/10 bg-gradient-to-b from-[#0f172a]/95 to-[#020617]/95 shadow-2xl overflow-hidden">
        {/* Top accent */}
        <div className="h-[3px] bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 relative overflow-hidden">
          <div className="absolute inset-y-0 w-24 bg-white/60 blur-md animate-[shimmer_1.8s_linear_infinite]" />
        </div>

        <div className="px-6 pt-5 pb-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="relative">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304M3 12c0-4.97 4.03-9 9-9s9 4.03 9 9-4.03 9-9 9-9-4.03-9-9z"/></svg>
              </div>
              <div className="absolute inset-0 rounded-lg ring-2 ring-blue-400/60 animate-ping" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold tracking-[0.2em] text-blue-300/70 uppercase">Cably · Geo Engine</div>
              <div className="text-sm font-semibold text-white tracking-tight">Loading network intelligence</div>
            </div>
            <div className="text-xs font-mono text-blue-300/80 tabular-nums">{overallPct}%</div>
          </div>

          {/* Progress bar */}
          <div className="relative h-1.5 rounded-full bg-white/5 overflow-hidden mb-5">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all duration-300" style={{ width: `${overallPct}%` }} />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent)] bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" />
          </div>

          {/* Stages */}
          <div className="space-y-2 mb-5">
            {STAGES.map((st, i) => {
              const done = i < currentIdx || state.stage === 'done'
              const active = i === currentIdx && state.stage !== 'done'
              return (
                <div key={st.id} className="flex items-center gap-3 text-[11px]">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    done ? 'bg-emerald-400/20 ring-1 ring-emerald-400/60'
                    : active ? 'bg-blue-400/20 ring-1 ring-blue-400'
                    : 'bg-white/5 ring-1 ring-white/10'
                  }`}>
                    {done ? (
                      <svg className="w-2.5 h-2.5 text-emerald-300" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    ) : active ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
                    ) : (
                      <div className="w-1 h-1 rounded-full bg-white/30" />
                    )}
                  </div>
                  <div className={`font-mono uppercase tracking-wider w-14 shrink-0 text-[9px] font-bold ${done ? 'text-emerald-300/80' : active ? 'text-blue-300' : 'text-white/30'}`}>{st.label}</div>
                  <div className={`flex-1 ${done ? 'text-white/50' : active ? 'text-white/90' : 'text-white/30'}`}>{st.desc}</div>
                  {active && (
                    <div className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-blue-300/80 animate-[pulse_1s_ease-in-out_infinite]" />
                      <span className="w-1 h-1 rounded-full bg-blue-300/80 animate-[pulse_1s_ease-in-out_0.2s_infinite]" />
                      <span className="w-1 h-1 rounded-full bg-blue-300/80 animate-[pulse_1s_ease-in-out_0.4s_infinite]" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Live counters */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Counter label="Datasets" value={`${state.datasetsDone}/${state.datasetsTotal || '—'}`} />
            <Counter label="Features" value={state.featuresPlotted.toLocaleString()} sub={state.featuresTotal ? `/ ${state.featuresTotal.toLocaleString()}` : undefined} />
            <Counter label="Attributes" value={state.attrsIndexed.toLocaleString()} />
          </div>

          {/* Current label */}
          <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 font-mono text-[10px] text-blue-200/80 min-h-[28px] flex items-center gap-2 overflow-hidden">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="truncate">{state.currentLabel || 'Standing by…'}</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
        @keyframes scanline { 0% { top: 12%; } 100% { top: 88%; } }
      `}</style>
    </div>
  )
}

function Counter({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[8px] font-bold tracking-[0.15em] text-blue-300/60 uppercase">{label}</div>
      <div className="text-sm font-mono font-semibold text-white tabular-nums">
        {value}{sub && <span className="text-[10px] font-normal text-white/40 ml-0.5">{sub}</span>}
      </div>
    </div>
  )
}
