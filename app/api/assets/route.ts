import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const datasetId = request.nextUrl.searchParams.get('dataset_id')
    let query = supabase
      .from('assets')
      .select('id, dataset_id, type, name, status, vendor_id, cost_per_km, total_cost, length_km, geometry, properties, created_at, updated_at')
    if (datasetId) query = query.eq('dataset_id', Number(datasetId))

    const { data, error } = await query
    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json([])
    }
    return NextResponse.json(data || [])
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
    // Auto-calculate total_cost
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
