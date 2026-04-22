import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Fetch all vendors
    const { data: vendors, error: vendorError } = await supabase
      .from('vendors')
      .select('*')
      .order('created_at', { ascending: false })

    if (vendorError) {
      console.error('Supabase error:', vendorError)
      return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 })
    }

    // Fetch asset counts and cost sums per vendor
    const { data: assetStats, error: statsError } = await supabase
      .from('assets')
      .select('vendor_id, total_cost')

    if (statsError) {
      console.error('Stats query error:', statsError)
      return NextResponse.json({ error: 'Failed to fetch vendor stats' }, { status: 500 })
    }

    // Aggregate in JS since Supabase JS client doesn't support GROUP BY natively
    const statsMap: Record<string, { asset_count: number; total_cost: number }> = {}
    for (const row of assetStats || []) {
      if (row.vendor_id == null) continue
      if (!statsMap[row.vendor_id]) {
        statsMap[row.vendor_id] = { asset_count: 0, total_cost: 0 }
      }
      statsMap[row.vendor_id].asset_count += 1
      statsMap[row.vendor_id].total_cost += Number(row.total_cost) || 0
    }

    const result = (vendors || []).map((vendor) => ({
      ...vendor,
      asset_count: statsMap[vendor.id]?.asset_count ?? 0,
      total_cost: statsMap[vendor.id]?.total_cost ?? 0,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    }

    const vendor = {
      name: body.name.trim(),
      contact_email: body.contact_email ?? null,
      contact_phone: body.contact_phone ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
    }

    const { data, error } = await supabase
      .from('vendors')
      .insert(vendor)
      .select()
      .single()

    if (error) {
      console.error('Vendor insert error:', error)
      return NextResponse.json({ error: 'Failed to create vendor' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
