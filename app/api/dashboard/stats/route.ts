import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest) {
  try {
    // Fetch all assets for aggregation
    const { data: assets, error: assetsError } = await supabase
      .from('assets')
      .select('type, status, length_km, total_cost')

    if (assetsError) {
      console.error('Assets query error:', assetsError)
      return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 })
    }

    // Fetch dataset count
    const { count: totalDatasets, error: datasetsError } = await supabase
      .from('datasets')
      .select('*', { count: 'exact', head: true })

    if (datasetsError) {
      console.error('Datasets count error:', datasetsError)
      return NextResponse.json({ error: 'Failed to fetch datasets count' }, { status: 500 })
    }

    // Fetch recent datasets
    const { data: recentDatasets, error: recentError } = await supabase
      .from('datasets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)

    if (recentError) {
      console.error('Recent datasets error:', recentError)
      return NextResponse.json({ error: 'Failed to fetch recent datasets' }, { status: 500 })
    }

    const rows = assets || []
    const totalAssets = rows.length
    let totalLengthKm = 0
    let totalCost = 0
    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}

    for (const row of rows) {
      totalLengthKm += Number(row.length_km) || 0
      totalCost += Number(row.total_cost) || 0

      const type = row.type ?? 'unknown'
      byType[type] = (byType[type] || 0) + 1

      const status = row.status ?? 'unknown'
      byStatus[status] = (byStatus[status] || 0) + 1
    }

    return NextResponse.json({
      totalAssets,
      totalDatasets: totalDatasets ?? 0,
      totalLengthKm,
      totalCost,
      byType,
      byStatus,
      recentDatasets: recentDatasets || [],
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
