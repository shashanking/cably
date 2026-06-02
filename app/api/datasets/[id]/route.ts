import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE /api/datasets/[id]
// Removes the dataset row. Associated assets cascade-delete via the FK on
// assets.dataset_id (REFERENCES datasets(id) ON DELETE CASCADE).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const datasetId = Number(id)
    if (!Number.isFinite(datasetId) || datasetId <= 0) {
      return NextResponse.json({ error: 'Invalid dataset id' }, { status: 400 })
    }
    const { error } = await supabase.from('datasets').delete().eq('id', datasetId)
    if (error) {
      console.error('[datasets/delete] error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ message: 'Dataset deleted', id: datasetId })
  } catch (err: any) {
    console.error('[datasets/delete] error:', err)
    return NextResponse.json({ error: err?.message || 'unknown error' }, { status: 500 })
  }
}
