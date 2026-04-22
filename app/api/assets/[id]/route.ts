import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data, error } = await supabase
      .from('assets')
      .select('*, vendors(name)')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
      }
      console.error('Supabase error:', error)
      return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 500 })
    }

    const asset = {
      ...data,
      vendor_name: data.vendors?.name ?? null,
    }
    delete asset.vendors

    return NextResponse.json(asset)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const allowedFields = [
      'name', 'type', 'status', 'vendor_id',
      'cost_per_km', 'total_cost', 'length_km',
      'operational_status', 'utilization_pct', 'capacity_pct',
      'region', 'installed_year',
      'properties', 'geometry',
    ]

    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Auto-calculate total_cost if both cost_per_km and length_km are available
    const costPerKm = updates.cost_per_km as number | undefined
    const lengthKm = updates.length_km as number | undefined
    if (costPerKm !== undefined && lengthKm !== undefined) {
      updates.total_cost = costPerKm * lengthKm
    } else if (costPerKm !== undefined || lengthKm !== undefined) {
      // One was provided but not the other -- fetch existing values to compute
      const { data: existing } = await supabase
        .from('assets')
        .select('cost_per_km, length_km')
        .eq('id', id)
        .single()

      if (existing) {
        const finalCost = costPerKm ?? existing.cost_per_km
        const finalLength = lengthKm ?? existing.length_km
        if (finalCost != null && finalLength != null) {
          updates.total_cost = finalCost * finalLength
        }
      }
    }

    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('assets')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
      }
      console.error('Supabase update error:', error)
      return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { error } = await supabase
      .from('assets')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Supabase delete error:', error)
      return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Asset deleted' })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
