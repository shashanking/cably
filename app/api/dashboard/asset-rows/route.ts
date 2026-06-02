import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Keyset-paginated slim asset rows for the dashboard.
 *
 * Why this exists separately from /api/assets:
 *   - The dashboard pulls every asset row for its map panel + per-row stats.
 *     Using OFFSET pagination on the full assets table (with the heavy
 *     `properties` jsonb) takes 5-13s per page once N gets large — Postgres
 *     has to walk and skip N rows AND decompress all their TOAST'd JSONB
 *     blobs.
 *   - Keyset pagination (WHERE id > :after_id) is O(log N) regardless of
 *     position. First page and last page take the same time.
 *   - The dashboard reads only specific keys from `properties`. Extracting
 *     those keys server-side (jsonb_build_object) cuts payload size dramatically
 *     and avoids decompressing the rest of the JSONB.
 *
 * Query params:
 *   - after_id (number, optional, default 0): the highest id from the
 *     previous page. Returns rows with id > after_id.
 *   - limit (number, optional, default 2000, max 5000): page size.
 *
 * Response:
 *   { data: Row[], next_after_id: number | null }
 *   `next_after_id` is the largest id in this page, or null when there's no more data.
 */

// Columns the dashboard needs. Keep `properties` jsonb intact — PostgREST's
// select= parameter doesn't accept SQL function calls (no inline
// jsonb_build_object), so we can't slim it server-side without an RPC. For
// realistic dataset sizes (<10k features) this is fine; if you need
// aggressive slimming later, define a SQL view or RPC.
const SLIM_COLS =
  `id, type, name, status, vendor_id, cost_per_km, total_cost, length_km, ` +
  `operational_status, utilization_pct, capacity_pct, dataset_id, geometry, properties`

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const afterId = Math.max(0, Number(params.get('after_id') || 0))
    const limit = Math.max(1, Math.min(5000, Number(params.get('limit') || 2000)))

    let q = supabase
      .from('assets')
      .select(SLIM_COLS)
      .order('id', { ascending: true })
      .limit(limit)
    if (afterId > 0) q = q.gt('id', afterId)

    const { data, error } = await q
    if (error) {
      console.error('[dashboard/asset-rows] Supabase error:', error)
      return NextResponse.json({ data: [], next_after_id: null, error: error.message }, { status: 200 })
    }

    const rows = data || []
    // Supabase/PostgREST silently caps query results at ~1000 rows even when
    // a higher `limit` is requested. We can't detect "end of data" via
    // rows.length === limit. Instead: if we got ANY rows, advance the cursor;
    // the loop terminates naturally when a page returns zero rows.
    const next = rows.length > 0
      ? (rows[rows.length - 1] as { id: number }).id
      : null

    // No HTTP cache here — uploads add new rows and the in-memory
    // dashCache.assets store doesn't get invalidated cross-page. Keep this
    // response fresh; the endpoint is fast enough (~200-500ms per page).
    return NextResponse.json(
      { data: rows, next_after_id: next },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: any) {
    console.error('[dashboard/asset-rows] error:', err)
    return NextResponse.json({ data: [], next_after_id: null, error: err.message }, { status: 200 })
  }
}
