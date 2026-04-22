import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'

// Columns the Fill Data Gaps table needs. NO geometry — the drawer fetches
// the full row via /api/assets/[id] when it needs the mini-map.
const SLIM_COLS = 'id, dataset_id, type, name, status, vendor_id, cost_per_km, total_cost, length_km, operational_status, utilization_pct, capacity_pct, region, installed_year, properties'

const REQUIRED_FIELDS = [
  'vendor_id', 'operational_status', 'utilization_pct', 'capacity_pct',
  'region', 'installed_year', 'cost_per_km', 'total_cost', 'length_km',
] as const

// GET /api/assets/gaps?limit=500&offset=0&field=<name>
// Returns { total, data } — rows where at least one required field is NULL.
// If `field` is supplied, restricts to rows where that specific field is NULL.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get('limit')) || 500))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const field = url.searchParams.get('field') || ''

  try {
    let query = supabase
      .from('assets')
      .select(SLIM_COLS, { count: 'exact' })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1)

    if (field && (REQUIRED_FIELDS as readonly string[]).includes(field)) {
      query = query.is(field, null)
    } else {
      // ANY required field is null
      const filter = REQUIRED_FIELDS.map(f => `${f}.is.null`).join(',')
      query = query.or(filter)
    }

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Trim properties to just the bits the table needs (folder path + name).
    // Full properties get fetched on-demand by the drawer.
    const slim = (data || []).map((r: any) => ({
      id: r.id,
      dataset_id: r.dataset_id,
      type: r.type,
      name: r.name,
      status: r.status,
      vendor_id: r.vendor_id,
      cost_per_km: r.cost_per_km,
      total_cost: r.total_cost,
      length_km: r.length_km,
      operational_status: r.operational_status,
      utilization_pct: r.utilization_pct,
      capacity_pct: r.capacity_pct,
      region: r.region,
      installed_year: r.installed_year,
      _folder: r.properties?.__folder || null,
      _prop_name: r.properties?.name || r.properties?.Name || null,
    }))

    return NextResponse.json({ total: count ?? slim.length, offset, limit, data: slim })
  } catch (err: any) {
    console.error('[assets/gaps] failed', err)
    return NextResponse.json({ error: err.message || 'gaps query failed' }, { status: 500 })
  }
}
