import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export const runtime = 'nodejs'

const SELECT_COLS = 'id, dataset_id, type, name, status, vendor_id, cost_per_km, total_cost, length_km, geometry, properties, created_at, updated_at'

async function fetchAllAssets(datasetId?: number) {
  const PAGE = 1000
  let all: any[] = []
  let from = 0

  while (true) {
    let query = supabase.from('assets').select(SELECT_COLS).range(from, from + PAGE - 1)
    if (datasetId) query = query.eq('dataset_id', datasetId)

    const { data, error } = await query
    if (error) { console.error('Supabase error:', error); break }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }

  return all
}

async function fetchPage(datasetId: number | undefined, offset: number, limit: number, wantCount: boolean) {
  let query = supabase
    .from('assets')
    .select(SELECT_COLS, wantCount ? { count: 'exact' } : undefined)
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (datasetId) query = query.eq('dataset_id', datasetId)

  const { data, error, count } = await query
  if (error) { console.error('Supabase error:', error); return { data: [], count: 0 } }
  return { data: data || [], count: count ?? 0 }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const datasetId = params.get('dataset_id')
    const limitRaw = params.get('limit')
    const offsetRaw = params.get('offset')
    const wantCount = params.get('count') === 'true'
    const dsId = datasetId ? Number(datasetId) : undefined

    // Paginated response when limit is specified
    if (limitRaw) {
      const limit = Math.max(1, Math.min(2000, Number(limitRaw)))
      const offset = Math.max(0, Number(offsetRaw) || 0)
      const { data, count } = await fetchPage(dsId, offset, limit, wantCount)
      return NextResponse.json({ data, total: count, offset, limit })
    }

    // Backwards-compatible: return the full array (used by map + insights).
    const data = await fetchAllAssets(dsId)
    return NextResponse.json(data)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json([])
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, geometry, properties, dataset_id, name, status, vendor_id, cost_per_km, total_cost, length_km } = body
    if (!type || !geometry) {
      return NextResponse.json({ error: 'Missing type or geometry' }, { status: 400 })
    }

    const row: Record<string, any> = {
      type,
      geometry,
      properties: properties ?? {},
      dataset_id: dataset_id ?? null,
      name: name || properties?.name || null,
      status: status || 'active',
      vendor_id: vendor_id ? Number(vendor_id) : null,
      cost_per_km: cost_per_km ? Number(cost_per_km) : null,
      length_km: length_km ? Number(length_km) : null,
    }
    if (total_cost) {
      row.total_cost = Number(total_cost)
    } else if (row.cost_per_km && row.length_km) {
      row.total_cost = row.cost_per_km * row.length_km
    }

    const { data, error } = await supabase
      .from('assets')
      .insert(row)
      .select('id')
      .single()

    if (error) {
      console.error('Asset insert error:', error)
      return NextResponse.json({ error: 'Failed to save asset' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Asset created', id: data?.id })
  } catch (error) {
    console.error('Asset API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
