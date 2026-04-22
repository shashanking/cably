import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'

const SLIM_COLS = 'id, dataset_id, type, name, status, vendor_id, cost_per_km, total_cost, length_km, operational_status, utilization_pct, capacity_pct, region, installed_year, properties'

const REQUIRED_FIELDS = [
  'vendor_id', 'operational_status', 'utilization_pct', 'capacity_pct',
  'region', 'installed_year', 'cost_per_km', 'total_cost', 'length_km',
] as const

// GET /api/assets/gaps
//   ?limit=500&offset=0
//   &field=<required-field>       — only rows where THAT field is null
//   &q=<search>                    — matches name or properties->>name/Name
//   &datasets=1,2                  — dataset multi-select
//   &groups=A,B                    — properties->>Group multi-select
//   &facilities=X,Y                — properties->>Facility multi-select
//   &geom=point,line               — geometry family multi-select
//
// Returns { total, data } — rows where at least one required field is NULL
// (via the asset_gaps_v view), narrowed by the supplied filter params.
// All filters AND together; options within a multi-select OR within the field.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get('limit')) || 500))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const field = url.searchParams.get('field') || ''
  const q = (url.searchParams.get('q') || '').trim()
  const datasetsParam = url.searchParams.get('datasets') || ''
  const groupsParam = url.searchParams.get('groups') || ''
  const facilitiesParam = url.searchParams.get('facilities') || ''
  const geomParam = url.searchParams.get('geom') || ''

  try {
    let query: any = supabase
      .from('asset_gaps_v')
      .select(SLIM_COLS, { count: 'exact' })
      .eq('has_gaps', true)
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1)

    // Focus on one specific missing field
    if (field && (REQUIRED_FIELDS as readonly string[]).includes(field)) {
      query = query.is(field, null)
    }

    // Dataset multi-select
    const datasetIds = datasetsParam.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n))
    if (datasetIds.length > 0) query = query.in('dataset_id', datasetIds)

    // Group / Facility — JSONB path filters on properties
    const groups = groupsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (groups.length > 0) query = query.in('properties->>Group', groups)
    const facilities = facilitiesParam.split(',').map(s => s.trim()).filter(Boolean)
    if (facilities.length > 0) query = query.in('properties->>Facility', facilities)

    // Search — try name column first (most common). For a single ILIKE we can
    // chain safely without conflicting with the has_gaps predicate.
    if (q) {
      const esc = q.replace(/[%_]/g, ch => `\\${ch}`)
      // Match name or the stored properties.name / properties.Name
      query = query.or(`name.ilike.*${esc}*,properties->>name.ilike.*${esc}*,properties->>Name.ilike.*${esc}*`)
    }

    // Geometry family — map to ILIKE patterns on type
    const geoms = geomParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (geoms.length === 1) {
      const g = geoms[0]
      if (g === 'point') query = query.ilike('type', '%point%')
      else if (g === 'line') query = query.ilike('type', '%line%')
      else if (g === 'polygon') query = query.ilike('type', '%polygon%')
    } else if (geoms.length > 1) {
      // Can't chain multiple ILIKE as AND; express as OR on type.
      // Only works when search (`q`) isn't also using .or(), since .or chains override.
      // In that rare combined case we drop the geom filter to keep search working.
      if (!q) {
        const ors: string[] = []
        for (const g of geoms) {
          if (g === 'point') ors.push('type.ilike.*point*')
          else if (g === 'line') ors.push('type.ilike.*line*')
          else if (g === 'polygon') ors.push('type.ilike.*polygon*')
        }
        if (ors.length > 0) query = query.or(ors.join(','))
      }
    }

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
      _group: r.properties?.Group || r.properties?.group || null,
      _facility: r.properties?.Facility || r.properties?.facility || null,
    }))

    return NextResponse.json({ total: count ?? slim.length, offset, limit, data: slim })
  } catch (err: any) {
    console.error('[assets/gaps] failed', err)
    return NextResponse.json({ error: err.message || 'gaps query failed' }, { status: 500 })
  }
}
