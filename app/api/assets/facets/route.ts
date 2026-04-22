import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Pulls distinct filter-friendly facets across the WHOLE assets table
// (vs. just the first page) — used by the Fill page's filter dropdowns.
// Streams through rows in 2k-wide chunks with only the columns we need,
// so it stays fast even on large datasets.
export async function GET() {
  try {
    const PAGE = 2000
    const CHUNK_COLS = 'dataset_id, type, properties'
    const folderCounts = new Map<string, number>()
    const groupCounts = new Map<string, number>()
    const facilityCounts = new Map<string, number>()
    const typeCounts = new Map<string, number>()
    const geomCounts = new Map<string, number>()
    const datasetCounts = new Map<number, number>()

    let from = 0
    // Guardrail: bail out if the table is huge (>500k rows) — adjust if needed
    const MAX_PAGES = 50
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('assets')
        .select(CHUNK_COLS)
        .range(from, from + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data || data.length === 0) break

      for (const r of data as any[]) {
        const ds = r.dataset_id
        if (ds != null) datasetCounts.set(ds, (datasetCounts.get(ds) || 0) + 1)
        if (r.type) typeCounts.set(r.type, (typeCounts.get(r.type) || 0) + 1)
        const geom = String(r.type || '').toLowerCase()
        const fam = geom.includes('point') ? 'point'
                  : geom.includes('line')  ? 'line'
                  : geom.includes('polygon') ? 'polygon' : 'other'
        geomCounts.set(fam, (geomCounts.get(fam) || 0) + 1)
        const p = r.properties || {}
        const folderArr = p.__folder
        if (Array.isArray(folderArr) && folderArr.length > 0) {
          const f = folderArr[folderArr.length - 1]
          if (f) folderCounts.set(String(f), (folderCounts.get(String(f)) || 0) + 1)
        }
        const group = p.Group || p.group
        if (group) groupCounts.set(String(group), (groupCounts.get(String(group)) || 0) + 1)
        const facility = p.Facility || p.facility
        if (facility) facilityCounts.set(String(facility), (facilityCounts.get(String(facility)) || 0) + 1)
      }
      if (data.length < PAGE) break
      from += PAGE
    }

    const asSortedArray = <K>(m: Map<K, number>) =>
      Array.from(m.entries())
        .map(([k, count]) => ({ value: k as any, count }))
        .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      datasets: asSortedArray(datasetCounts),
      types: asSortedArray(typeCounts),
      geometries: asSortedArray(geomCounts),
      folders: asSortedArray(folderCounts).slice(0, 100),
      groups: asSortedArray(groupCounts).slice(0, 200),
      facilities: asSortedArray(facilityCounts).slice(0, 500),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'facets failed' }, { status: 500 })
  }
}
