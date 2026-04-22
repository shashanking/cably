'use client'

import { useEffect, useState, useRef } from 'react'
import { useLoadingContext } from './LoadingContext'

const DEFAULT_STATUS = 'Initializing Geospatial Engine...'
const MIN_DURATION_MS = 900       // splash stays up at least this long (avoid flash)
const BOOT_MS = 500               // reach ~30% over this window before listening for tasks
const TASK_GRACE_MS = 400         // after mount, wait this long for a page to register a task
const MAX_DURATION_MS = 10000     // fallback: force dismiss even if a task never resolves

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const ctx = useLoadingContext()
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState(DEFAULT_STATUS)
  const [fadeOut, setFadeOut] = useState(false)
  const [particlesReady, setParticlesReady] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const startedAtRef = useRef(Date.now())
  const dismissingRef = useRef(false)
  const progressRef = useRef(0)

  // Particle network animation
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)

    const particles: { x: number; y: number; vx: number; vy: number; r: number; o: number }[] = []
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        o: Math.random() * 0.5 + 0.1,
      })
    }

    let raf: number
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 150) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(37, 99, 235, ${0.06 * (1 - dist / 150)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }
      // Draw particles
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(37, 99, 235, ${p.o})`
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    setParticlesReady(true)

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  // Smart event-driven progress — reads page loading tasks from LoadingContext.
  // Phases: boot → wait → done. Progress is lerped toward a target each frame.
  useEffect(() => {
    let frame: number
    const tick = () => {
      if (dismissingRef.current) return
      const elapsed = Date.now() - startedAtRef.current
      const tasks = ctx?.tasks || []
      const pending = tasks.length

      // Decide target progress and label
      let target: number
      let label = DEFAULT_STATUS
      const latest = tasks[tasks.length - 1]
      const hardTimeout = elapsed > MAX_DURATION_MS

      if (elapsed < BOOT_MS) {
        // Boot: 0 → 30 linear
        target = (elapsed / BOOT_MS) * 30
        label = DEFAULT_STATUS
      } else if (!hardTimeout && (pending > 0 || (elapsed - BOOT_MS) < TASK_GRACE_MS)) {
        // Wait: creep toward 88 but never exceed it while tasks are pending
        const waitElapsed = Math.max(0, elapsed - BOOT_MS)
        target = Math.min(88, 30 + (waitElapsed / 2500) * 58)
        label = latest ? latest.label : 'Preparing…'
      } else {
        // Done (tasks cleared past grace, OR min duration reached, OR hard timeout)
        target = 100
        label = 'System Ready'
      }

      // Respect minimum splash duration before allowing 100%
      if (target >= 100 && elapsed < MIN_DURATION_MS) {
        target = 92 + (elapsed / MIN_DURATION_MS) * 8
        label = latest ? latest.label : 'Almost ready…'
      }

      // Smooth lerp toward target
      const next = progressRef.current + (target - progressRef.current) * 0.18
      progressRef.current = next
      setProgress(Math.round(next))
      setStatus(label)

      if (target >= 100 && Math.abs(next - 100) < 0.6 && elapsed >= MIN_DURATION_MS) {
        dismissingRef.current = true
        setProgress(100)
        setTimeout(() => {
          setFadeOut(true)
          setTimeout(onComplete, 600)
        }, 180)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // We intentionally ignore ctx?.tasks from deps — the rAF loop reads the
    // latest `ctx` closure each tick via the stable reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, onComplete])

  return (
    <div className={`fixed inset-0 z-[99999] transition-all duration-600 ${fadeOut ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'}`} style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f0fdf4 100%)' }}>
      {/* Particle canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 z-0" />

      {/* Animated gradient orbs */}
      <div className="absolute inset-0 overflow-hidden z-0">
        <div className="absolute w-[600px] h-[600px] rounded-full opacity-20 blur-3xl" style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', top: '20%', left: '10%', animation: 'float1 8s ease-in-out infinite' }} />
        <div className="absolute w-[500px] h-[500px] rounded-full opacity-15 blur-3xl" style={{ background: 'radial-gradient(circle, #10b981 0%, transparent 70%)', bottom: '10%', right: '15%', animation: 'float2 10s ease-in-out infinite' }} />
        <div className="absolute w-[300px] h-[300px] rounded-full opacity-10 blur-2xl" style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)', top: '60%', left: '50%', animation: 'float3 6s ease-in-out infinite' }} />
      </div>

      {/* Rotating orbital rings */}
      <div className="absolute inset-0 flex items-center justify-center z-0 opacity-30">
        <div className="absolute w-[500px] h-[500px] border border-blue-300/20 rounded-full" style={{ animation: 'orbit 30s linear infinite' }} />
        <div className="absolute w-[400px] h-[400px] border border-emerald-300/15 rounded-full" style={{ animation: 'orbit 22s linear infinite reverse' }} />
        <div className="absolute w-[300px] h-[300px] border border-violet-300/10 rounded-full" style={{ animation: 'orbit 15s linear infinite' }} />
        <div className="absolute w-[200px] h-[200px] border border-blue-200/20 rounded-full" style={{ animation: 'orbit 10s linear infinite reverse' }} />
        {/* Orbital dots */}
        <div className="absolute w-[500px] h-[500px]" style={{ animation: 'orbit 30s linear infinite' }}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-blue-400/40" />
        </div>
        <div className="absolute w-[400px] h-[400px]" style={{ animation: 'orbit 22s linear infinite reverse' }}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400/50" />
        </div>
      </div>

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-center px-8 py-5 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20" style={{ animation: 'logoPulse 2s ease-in-out infinite' }}>
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.919 17.919 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg>
          </div>
          <span className="text-sm font-bold tracking-[0.25em] text-blue-600 uppercase">CABLY</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ animation: 'blink 1.5s ease-in-out infinite' }} />
          <span>SYSTEM ONLINE</span>
        </div>
      </div>

      {/* Main content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6">
        <div className={`max-w-lg w-full text-center transition-all duration-700 ${particlesReady ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          {/* Logo */}
          <div className="mb-12">
            <div className="inline-flex items-center justify-center w-24 h-24 mb-6 rounded-3xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 shadow-2xl shadow-blue-500/30 relative" style={{ animation: 'logoFloat 3s ease-in-out infinite' }}>
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/20 to-transparent" />
              <svg className="w-12 h-12 text-white relative z-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.919 17.919 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg>
              {/* Glow ring */}
              <div className="absolute -inset-2 rounded-[1.5rem] border border-blue-300/20" style={{ animation: 'ringPulse 2s ease-in-out infinite' }} />
            </div>

            <h1 className="text-6xl font-extrabold tracking-tight mb-2" style={{ fontFamily: 'system-ui' }}>
              <span className="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-600 bg-clip-text text-transparent">CAB</span>
              <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">LY</span>
            </h1>
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-blue-300" />
              <p className="text-[10px] uppercase tracking-[0.5em] text-slate-400 font-semibold">
                Network Intelligence Platform
              </p>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-blue-300" />
            </div>
          </div>

          {/* Loading section */}
          <div className="space-y-5 px-4">
            <div className="flex justify-between items-end mb-1">
              <div className="text-left">
                <p className="text-[8px] uppercase tracking-[0.3em] text-blue-500 font-bold mb-1">System Status</p>
                <p className="text-sm text-slate-600 font-medium" style={{ animation: progress < 100 ? 'pulse 1.5s ease-in-out infinite' : 'none' }}>{status}</p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold tabular-nums bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent" style={{ fontFamily: 'system-ui' }}>{progress}<span className="text-sm ml-0.5 text-blue-400">%</span></span>
              </div>
            </div>

            {/* Multi-layer progress bar */}
            <div className="relative">
              <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden backdrop-blur-sm">
                <div className="h-full rounded-full relative overflow-hidden transition-all duration-75 ease-out" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #2563eb, #3b82f6, #10b981)' }}>
                  {/* Shine effect */}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)', animation: 'shine 1.5s ease-in-out infinite' }} />
                </div>
              </div>
              {/* Glow under bar */}
              <div className="absolute top-1 h-2 rounded-full blur-md opacity-40 transition-all duration-75" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #2563eb, #10b981)' }} />
            </div>

            {/* Metadata cards */}
            <div className="flex justify-center gap-6 pt-6">
              {[
                { label: 'Platform', value: 'GIS v1.0', color: 'text-slate-600' },
                { label: 'Database', value: 'Connected', color: 'text-emerald-600' },
                { label: 'Map Engine', value: 'Google Maps', color: 'text-blue-600' },
                { label: 'Protocol', value: 'Secured', color: 'text-emerald-600' },
              ].map((m, i) => (
                <div key={m.label} className="text-center opacity-0" style={{ animation: `fadeSlideUp 0.4s ease-out ${0.3 + i * 0.1}s forwards` }}>
                  <p className="text-[7px] uppercase tracking-[0.25em] text-slate-400 mb-0.5 font-semibold">{m.label}</p>
                  <p className={`text-[11px] font-semibold ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-center px-8 py-4 z-10">
        <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">© 2025 Cably &middot; MVP v1.0</p>
        <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">Fiber Network Mapping & Intelligence</p>
      </div>

      <style>{`
        @keyframes orbit { to { transform: rotate(360deg); } }
        @keyframes float1 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(30px, -20px); } }
        @keyframes float2 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-25px, 15px); } }
        @keyframes float3 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(15px, 25px); } }
        @keyframes logoFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes logoPulse { 0%, 100% { box-shadow: 0 4px 15px rgba(59,130,246,0.2); } 50% { box-shadow: 0 4px 25px rgba(59,130,246,0.4); } }
        @keyframes ringPulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.08); opacity: 0.6; } }
        @keyframes shine { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      `}</style>
    </div>
  )
}
