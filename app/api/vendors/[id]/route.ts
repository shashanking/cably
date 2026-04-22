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

    const { data: vendor, error } = await supabase
      .from('vendors')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
      }
      console.error('Supabase error:', error)
      return NextResponse.json({ error: 'Failed to fetch vendor' }, { status: 500 })
    }

    // Get linked assets count and total cost
    const { data: assets, error: assetsError } = await supabase
      .from('assets')
      .select('total_cost')
      .eq('vendor_id', id)

    if (assetsError) {
      console.error('Assets query error:', assetsError)
      return NextResponse.json({ error: 'Failed to fetch vendor stats' }, { status: 500 })
    }

    const assetCount = assets?.length ?? 0
    const totalCost = (assets || []).reduce(
      (sum, a) => sum + (Number(a.total_cost) || 0),
      0
    )

    return NextResponse.json({
      ...vendor,
      asset_count: assetCount,
      total_cost: totalCost,
    })
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

    const allowedFields = ['name', 'contact_email', 'contact_phone', 'address', 'notes']
    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('vendors')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
      }
      console.error('Supabase update error:', error)
      return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
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

    // Check for linked assets before deleting
    const { data: linkedAssets, error: checkError } = await supabase
      .from('assets')
      .select('id')
      .eq('vendor_id', id)
      .limit(1)

    if (checkError) {
      console.error('Check linked assets error:', checkError)
      return NextResponse.json({ error: 'Failed to verify vendor dependencies' }, { status: 500 })
    }

    if (linkedAssets && linkedAssets.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete vendor with linked assets. Reassign or remove assets first.' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('vendors')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Supabase delete error:', error)
      return NextResponse.json({ error: 'Failed to delete vendor' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Vendor deleted' })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
