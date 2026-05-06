import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

type Bbox = { minLng: number; minLat: number; maxLng: number; maxLat: number }

function extendBbox(bbox: Bbox | null, coords: any): Bbox | null {
  if (!Array.isArray(coords)) return bbox
  if (typeof coords[0] === 'number') {
    const [lng, lat] = coords
    if (typeof lng !== 'number' || typeof lat !== 'number') return bbox
    if (!bbox) return { minLng: lng, minLat: lat, maxLng: lng, maxLat: lat }
    return {
      minLng: Math.min(bbox.minLng, lng),
      minLat: Math.min(bbox.minLat, lat),
      maxLng: Math.max(bbox.maxLng, lng),
      maxLat: Math.max(bbox.maxLat, lat),
    }
  }
  let acc = bbox
  for (const c of coords) acc = extendBbox(acc, c)
  return acc
}

async function backfill(datasetId: number) {
  const { data } = await supabase
    .from('assets')
    .select('geometry')
    .eq('dataset_id', datasetId)
  let bbox: Bbox | null = null
  for (const row of data || []) bbox = extendBbox(bbox, (row as any).geometry?.coordinates)
  const centroid = bbox
    ? { lng: (bbox.minLng + bbox.maxLng) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 }
    : null
  await supabase.from('datasets').update({ bbox, centroid }).eq('id', datasetId)
  return { bbox, centroid }
}

// Track which dataset backfills are already running so a hot-reload spam
// doesn't trigger N concurrent backfills for the same row.
const backfillInFlight = new Set<number>()
function backfillIfNeeded(datasetId: number) {
  if (backfillInFlight.has(datasetId)) return
  backfillInFlight.add(datasetId)
  backfill(datasetId)
    .catch(err => console.error('Background backfill failed:', err))
    .finally(() => backfillInFlight.delete(datasetId))
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('datasets')
      .select('id, name, source_file, feature_count, bbox, centroid, created_at')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Datasets list error:', error)
      return NextResponse.json([])
    }
    const rows = data || []
    // Fire backfills in the background — never block the response on them.
    for (const row of rows) {
      if (row.feature_count > 0 && (!row.bbox || !row.centroid)) {
        backfillIfNeeded(row.id)
      }
    }
    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
    })
  } catch (error) {
    console.error('Datasets API error:', error)
    return NextResponse.json([])
  }
}
