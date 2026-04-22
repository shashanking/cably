'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export interface LoadingTask {
  id: string
  label: string
  startedAt: number
}

interface Ctx {
  tasks: LoadingTask[]
  register: (id: string, label: string) => void
  unregister: (id: string) => void
}

const LoadingContext = createContext<Ctx | null>(null)

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<LoadingTask[]>([])
  const register = useCallback((id: string, label: string) => {
    setTasks(prev => (prev.find(t => t.id === id) ? prev.map(t => t.id === id ? { ...t, label } : t) : [...prev, { id, label, startedAt: Date.now() }]))
  }, [])
  const unregister = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [])
  return (
    <LoadingContext.Provider value={{ tasks, register, unregister }}>
      {children}
    </LoadingContext.Provider>
  )
}

export function useLoadingContext() {
  return useContext(LoadingContext)
}

/**
 * Register a page loading task with the splash. Call with `loading=true`
 * while the page is waiting on data, switch to `loading=false` when done.
 * The task auto-unregisters on unmount.
 */
export function usePageLoading(id: string, loading: boolean, label = 'Loading…') {
  const ctx = useLoadingContext()
  // Keep latest label in a ref so label changes don't thrash register/unregister
  const labelRef = useRef(label)
  labelRef.current = label

  useEffect(() => {
    if (!ctx) return
    if (loading) ctx.register(id, labelRef.current)
    else ctx.unregister(id)
    return () => { ctx?.unregister(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, id])
}
