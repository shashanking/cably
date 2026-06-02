import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same pattern as /api/dashboard/summary: try the RPC, fall back to a stale
// cache if Supabase times out / errors out. Without the fallback an
// intermittent DB hiccup would blank out the dashboard sidebar.
type FacetsPayload = Record<string, unknown>
const STALE_FALLBACK_MAX_AGE_MS = 5 * 60_000
let lastSuccessful: { data: FacetsPayload; ts: number } | null = null

export async function GET() {
  try {
    const { data, error } = await supabase.rpc('dashboard_facets')
    if (error) throw new Error(`Supabase: ${error.message}`)
    if (!data) throw new Error('dashboard_facets returned no data')
    lastSuccessful = { data: data as FacetsPayload, ts: Date.now() }
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' },
    })
  } catch (err: any) {
    console.error('[dashboard/facets] RPC failed', err)
    if (lastSuccessful && Date.now() - lastSuccessful.ts < STALE_FALLBACK_MAX_AGE_MS) {
      return NextResponse.json(lastSuccessful.data, {
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
          'X-Cache': 'stale-fallback',
          'X-Cache-Age-Ms': String(Date.now() - lastSuccessful.ts),
        },
      })
    }
    // Empty-but-valid shape so the client doesn't crash.
    return NextResponse.json({
      vendors: [], owners: [], groups: [], facilities: [],
      noVendor: 0, noOwner: 0, noGroup: 0, noFacility: 0,
      error: err.message || 'facets aggregation failed',
    })
  }
}
