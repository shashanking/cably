import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'

// PATCH /api/assets/bulk
// Body: { ids: number[], vendor_id?: number | null, status?: string, cost_per_km?: number }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const ids = Array.isArray(body.ids) ? body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : []
    if (ids.length === 0) return NextResponse.json({ error: 'ids is required' }, { status: 400 })

    const updates: Record<string, unknown> = {}
    if (body.vendor_id !== undefined) updates.vendor_id = body.vendor_id === null ? null : Number(body.vendor_id)
    if (body.status !== undefined) updates.status = String(body.status)
    if (body.cost_per_km !== undefined && body.cost_per_km !== null && body.cost_per_km !== '') {
      updates.cost_per_km = Number(body.cost_per_km)
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('assets')
      .update(updates)
      .in('id', ids)
      .select('id, vendor_id, status, cost_per_km, length_km, total_cost')

    if (error) {
      console.error('Bulk update error:', error)
      return NextResponse.json({ error: 'Failed to update assets' }, { status: 500 })
    }

    // Recompute total_cost where possible (cost_per_km may have changed)
    if (updates.cost_per_km !== undefined && Array.isArray(data)) {
      const recompute = data
        .filter(r => r.cost_per_km != null && r.length_km != null)
        .map(r => ({ id: r.id, total_cost: Number(r.cost_per_km) * Number(r.length_km) }))
      if (recompute.length > 0) {
        // Supabase JS can't do a single batched update with distinct values per row without upsert,
        // so issue one update-per-row. For typical selection sizes this is fine.
        await Promise.all(
          recompute.map(r => supabase.from('assets').update({ total_cost: r.total_cost }).eq('id', r.id))
        )
      }
    }

    return NextResponse.json({ updated: data?.length ?? 0, ids })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
