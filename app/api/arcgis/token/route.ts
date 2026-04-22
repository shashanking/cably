import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OAUTH_URL = 'https://www.arcgis.com/sharing/rest/oauth2/token'

let cached: { token: string; expiresAt: number } | null = null
// Dedupe concurrent mint requests. Dev HMR / page burst can hit this route
// from multiple components at once while cache is empty, each triggering a
// separate OAuth round-trip — ArcGIS rate-limits and we get sporadic 500s.
let inflight: Promise<{ token: string; expiresAt: number }> | null = null

async function mintToken(): Promise<{ token: string; expiresAt: number }> {
  const clientId = process.env.ARCGIS_CLIENT_ID
  const clientSecret = process.env.ARCGIS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('ARCGIS_CLIENT_ID / ARCGIS_CLIENT_SECRET not configured')
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    expiration: '60',
    f: 'json',
  })

  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })

  const json = await res.json()
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`ArcGIS token exchange failed: ${JSON.stringify(json)}`)
  }

  const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return {
    token: json.access_token,
    expiresAt: Date.now() + (expiresInSec - 60) * 1000,
  }
}

export async function GET() {
  try {
    if (!cached || Date.now() >= cached.expiresAt) {
      if (!inflight) {
        inflight = mintToken().finally(() => { inflight = null })
      }
      cached = await inflight
    }
    return NextResponse.json({
      token: cached.token,
      expiresAt: cached.expiresAt,
      portalUrl: process.env.NEXT_PUBLIC_ARCGIS_ORG_URL || 'https://www.arcgis.com',
    })
  } catch (err: any) {
    cached = null
    console.error('[arcgis/token]', err)
    return NextResponse.json({ error: err.message || 'token_failed' }, { status: 500 })
  }
}
