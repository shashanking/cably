import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const datasetId = request.nextUrl.searchParams.get('dataset_id')
    let query = supabase
      .from('assets')
      .select('id, dataset_id, type, geometry, properties, created_at')
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
    const { type, geometry, properties, dataset_id } = body
    if (!type || !geometry || !properties) {
      return NextResponse.json({ error: 'Missing asset payload' }, { status: 400 })
    }

    const { error } = await supabase
      .from('assets')
      .insert({ type, geometry, properties, dataset_id: dataset_id ?? null })

    if (error) {
      console.error('Asset insert error:', error)
      return NextResponse.json({ error: 'Failed to save asset' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Asset created' })
  } catch (error) {
    console.error('Asset API error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
