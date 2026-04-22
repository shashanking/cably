'use client'

import { useState, useCallback } from 'react'
import SplashScreen from './SplashScreen'
import HeaderBar from './HeaderBar'
import { LoadingProvider } from './LoadingContext'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(true)

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false)
  }, [])

  return (
    <LoadingProvider>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      <div className="min-h-screen flex flex-col">
        <HeaderBar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </LoadingProvider>
  )
}
