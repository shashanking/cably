import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function fetchAllLightAssets() {
  const PAGE = 1000
  let all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('assets').select('type, status, length_km, total_cost').range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export async function GET(_request: NextRequest) {
  try {
    const rows = await fetchAllLightAssets()

    const { count: totalDatasets } = await supabase.from('datasets').select('*', { count: 'exact', head: true })
    const { data: recentDatasets } = await supabase.from('datasets').select('*').order('created_at', { ascending: false }).limit(5)

    let totalLengthKm = 0, totalCost = 0
    const byType: Record<string, number> = {}, byStatus: Record<string, number> = {}

    for (const row of rows) {
      totalLengthKm += Number(row.length_km) || 0
      totalCost += Number(row.total_cost) || 0
      const type = row.type ?? 'unknown'; byType[type] = (byType[type] || 0) + 1
      const status = row.status ?? 'unknown'; byStatus[status] = (byStatus[status] || 0) + 1
    }

    return NextResponse.json({
      totalAssets: rows.length,
      totalDatasets: totalDatasets ?? 0,
      totalLengthKm, totalCost, byType, byStatus,
      recentDatasets: recentDatasets || [],
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
