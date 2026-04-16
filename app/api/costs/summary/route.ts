import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'

async function fetchAllCostAssets() {
  const PAGE = 1000
  let all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('assets').select('total_cost, length_km, cost_per_km, status, vendor_id, vendors(name)').range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export async function GET(_request: NextRequest) {
  try {
    const rows = await fetchAllCostAssets()

    let totalCost = 0, totalLengthKm = 0
    for (const row of rows) { totalCost += Number(row.total_cost) || 0; totalLengthKm += Number(row.length_km) || 0 }
    const avgCostPerKm = totalLengthKm > 0 ? totalCost / totalLengthKm : 0

    const vendorMap: Record<string, { vendor: string; cost: number; length: number }> = {}
    for (const row of rows) {
      const vendorId = row.vendor_id ?? '__unassigned__'
      const vendorData = row.vendors as { name: string } | { name: string }[] | null
      const vendorName = Array.isArray(vendorData) ? vendorData[0]?.name ?? 'Unassigned' : vendorData?.name ?? 'Unassigned'
      if (!vendorMap[vendorId]) vendorMap[vendorId] = { vendor: vendorName, cost: 0, length: 0 }
      vendorMap[vendorId].cost += Number(row.total_cost) || 0
      vendorMap[vendorId].length += Number(row.length_km) || 0
    }

    const statusMap: Record<string, { status: string; cost: number; count: number }> = {}
    for (const row of rows) {
      const status = row.status ?? 'unknown'
      if (!statusMap[status]) statusMap[status] = { status, cost: 0, count: 0 }
      statusMap[status].cost += Number(row.total_cost) || 0
      statusMap[status].count += 1
    }

    return NextResponse.json({
      totalCost, totalLengthKm,
      avgCostPerKm: Math.round(avgCostPerKm * 100) / 100,
      costByVendor: Object.values(vendorMap),
      costByStatus: Object.values(statusMap),
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
