import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'

// GET /api/assets/geometries?ids=1,2,3
// Returns only id + geometry + name + type for the given asset IDs.
// Used by the Fill page to render multiple selected features on one mini-map.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const idsRaw = url.searchParams.get('ids') || ''
  const ids = idsRaw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n))
  if (ids.length === 0) return NextResponse.json({ data: [] })
  // Guardrail: cap at 500 to prevent runaway queries
  const capped = ids.slice(0, 500)

  try {
    const { data, error } = await supabase
      .from('assets')
      .select('id, name, type, geometry, dataset_id, vendor_id, status, operational_status, utilization_pct, capacity_pct, length_km, cost_per_km, total_cost, installed_year, region')
      .in('id', capped)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'batch geometry query failed' }, { status: 500 })
  }
}
