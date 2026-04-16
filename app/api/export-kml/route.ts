import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import tokml from 'tokml'

export const runtime = 'nodejs'

async function fetchAllForExport() {
  const PAGE = 1000
  let all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('assets').select('id, type, geometry, properties').range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export async function GET() {
  try {
    const data = await fetchAllForExport()

    const geojson = {
      type: 'FeatureCollection',
      features: data.map((asset: any) => ({
        type: 'Feature',
        geometry: asset.geometry,
        properties: { id: asset.id, assetType: asset.type, ...asset.properties }
      }))
    }

    const kml = tokml(geojson, { name: 'assetType' })
    return new Response(kml, {
      headers: {
        'Content-Type': 'application/vnd.google-earth.kml+xml',
        'Content-Disposition': 'attachment; filename=assets.kml'
      }
    })
  } catch (error) {
    console.error('KML export error:', error)
    return NextResponse.json({ error: 'Failed to export KML' }, { status: 500 })
  }
}
