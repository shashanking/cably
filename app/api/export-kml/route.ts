import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import tokml from 'tokml'

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('assets')
      .select('id, type, geometry, properties')

    if (error) {
      console.error('Supabase export error:', error)
      return NextResponse.json({ error: 'Failed to export KML' }, { status: 500 })
    }

    const geojson = {
      type: 'FeatureCollection',
      features: (data || []).map((asset: any) => ({
        type: 'Feature',
        geometry: asset.geometry,
        properties: {
          id: asset.id,
          assetType: asset.type,
          ...asset.properties
        }
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
