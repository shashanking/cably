import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export const runtime = 'nodejs'

export async function GET() {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('target_year', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const row = {
    name: body.name,
    target_year: Number(body.target_year),
    planned_miles: Number(body.planned_miles) || 0,
    budget: Number(body.budget) || 0,
    status: body.status || 'on_track',
    notes: body.notes || null,
  }
  if (!row.name || !row.target_year) {
    return NextResponse.json({ error: 'name and target_year are required' }, { status: 400 })
  }
  const { data, error } = await supabase.from('plans').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
