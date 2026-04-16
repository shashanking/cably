import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest) {
  try {
    // Fetch all assets with vendor info for aggregation
    const { data: assets, error } = await supabase
      .from('assets')
      .select('total_cost, length_km, cost_per_km, status, vendor_id, vendors(name)')

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: 'Failed to fetch cost data' }, { status: 500 })
    }

    const rows = assets || []

    // Overall totals
    let totalCost = 0
    let totalLengthKm = 0
    for (const row of rows) {
      totalCost += Number(row.total_cost) || 0
      totalLengthKm += Number(row.length_km) || 0
    }
    const avgCostPerKm = totalLengthKm > 0 ? totalCost / totalLengthKm : 0

    // Cost by vendor
    const vendorMap: Record<string, { vendor: string; cost: number; length: number }> = {}
    for (const row of rows) {
      const vendorId = row.vendor_id ?? '__unassigned__'
      const vendorData = row.vendors as { name: string } | { name: string }[] | null
      const vendorName = Array.isArray(vendorData)
        ? vendorData[0]?.name ?? 'Unassigned'
        : vendorData?.name ?? 'Unassigned'
      if (!vendorMap[vendorId]) {
        vendorMap[vendorId] = { vendor: vendorName, cost: 0, length: 0 }
      }
      vendorMap[vendorId].cost += Number(row.total_cost) || 0
      vendorMap[vendorId].length += Number(row.length_km) || 0
    }
    const costByVendor = Object.values(vendorMap)

    // Cost by status
    const statusMap: Record<string, { status: string; cost: number; count: number }> = {}
    for (const row of rows) {
      const status = row.status ?? 'unknown'
      if (!statusMap[status]) {
        statusMap[status] = { status, cost: 0, count: 0 }
      }
      statusMap[status].cost += Number(row.total_cost) || 0
      statusMap[status].count += 1
    }
    const costByStatus = Object.values(statusMap)

    return NextResponse.json({
      totalCost,
      totalLengthKm,
      avgCostPerKm: Math.round(avgCostPerKm * 100) / 100,
      costByVendor,
      costByStatus,
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
