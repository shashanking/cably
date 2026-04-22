import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import * as toGeoJSON from '@tmcw/togeojson'
import { DOMParser } from 'xmldom'
import JSZip from 'jszip'
import { geomLengthKm } from '../../../lib/geo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function extractKmlFromKmz(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const entry =
    zip.file('doc.kml') ||
    Object.values(zip.files).find(f => !f.dir && f.name.toLowerCase().endsWith('.kml'))
  if (!entry) throw new Error('KMZ archive contains no .kml file')
  return entry.async('string')
}

type Annotation = { folder: string[]; color: string | null }

function abgrToHex(abgr: string | null | undefined): string | null {
  if (!abgr) return null
  const s = abgr.trim().toLowerCase()
  if (!/^[0-9a-f]{8}$/.test(s)) return null
  const r = s.substring(6, 8)
  const g = s.substring(4, 6)
  const b = s.substring(2, 4)
  return `#${r}${g}${b}`
}

function childElements(node: any): any[] {
  const out: any[] = []
  const kids = node.childNodes
  if (!kids) return out
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]
    if (c.nodeType === 1) out.push(c)
  }
  return out
}

function childText(el: any, tag: string): string | null {
  const kids = childElements(el)
  for (const c of kids) {
    if (c.tagName === tag) return c.firstChild?.nodeValue?.trim() || ''
  }
  return null
}

function parseDocumentStyles(doc: any): Record<string, string | null> {
  const styles: Record<string, { color: string | null }> = {}
  const styleEls = doc.getElementsByTagName('Style')
  for (let i = 0; i < styleEls.length; i++) {
    const el = styleEls[i]
    const id = el.getAttribute('id')
    if (!id) continue
    let color: string | null = null
    for (const tag of ['LineStyle', 'PolyStyle', 'IconStyle']) {
      const sub = el.getElementsByTagName(tag)
      if (sub.length > 0) {
        const colorEl = sub[0].getElementsByTagName('color')[0]
        const hex = abgrToHex(colorEl?.firstChild?.nodeValue)
        if (hex) { color = hex; break }
      }
    }
    styles[id] = { color }
  }
  const result: Record<string, string | null> = {}
  for (const [id, s] of Object.entries(styles)) {
    result[id] = s.color
  }
  const styleMaps = doc.getElementsByTagName('StyleMap')
  for (let i = 0; i < styleMaps.length; i++) {
    const sm = styleMaps[i]
    const id = sm.getAttribute('id')
    if (!id) continue
    const pairs = sm.getElementsByTagName('Pair')
    for (let j = 0; j < pairs.length; j++) {
      const keyEl = pairs[j].getElementsByTagName('key')[0]
      if (keyEl?.firstChild?.nodeValue?.trim() === 'normal') {
        const urlEl = pairs[j].getElementsByTagName('styleUrl')[0]
        const ref = urlEl?.firstChild?.nodeValue?.trim()?.replace('#', '')
        if (ref && result[ref] !== undefined) {
          result[id] = result[ref]
        }
        break
      }
    }
  }
  return result
}

function extractColor(placemark: any, docStyles: Record<string, string | null>): string | null {
  const styles = placemark.getElementsByTagName('Style')
  for (let i = 0; i < styles.length; i++) {
    for (const tag of ['LineStyle', 'IconStyle', 'PolyStyle']) {
      const els = styles[i].getElementsByTagName(tag)
      if (els.length > 0) {
        const colorEl = els[0].getElementsByTagName('color')[0]
        const hex = abgrToHex(colorEl?.firstChild?.nodeValue)
        if (hex) return hex
      }
    }
  }
  const styleUrlEl = placemark.getElementsByTagName('styleUrl')[0]
  const styleRef = styleUrlEl?.firstChild?.nodeValue?.trim()?.replace('#', '')
  if (styleRef && docStyles[styleRef] !== undefined) {
    return docStyles[styleRef]
  }
  return null
}

function walkKml(node: any, folder: string[], out: Annotation[], docStyles: Record<string, string | null>) {
  for (const el of childElements(node)) {
    if (el.tagName === 'Placemark') {
      out.push({ folder, color: extractColor(el, docStyles) })
    } else if (el.tagName === 'Folder') {
      const name = childText(el, 'name')
      const nextFolder = name ? [...folder, name] : folder
      walkKml(el, nextFolder, out, docStyles)
    } else {
      walkKml(el, folder, out, docStyles)
    }
  }
}

function parseKml(text: string) {
  const cleaned = text
    .replace(/<altitudeMode>[\s\S]*?<\/altitudeMode>/gi, '')
    .replace(/<gx:altitudeMode>[\s\S]*?<\/gx:altitudeMode>/gi, '')
  const dom = new DOMParser({
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e } },
  }).parseFromString(cleaned, 'text/xml')
  const docEl = dom.getElementsByTagName('Document')[0]
  const docName = docEl ? childText(docEl, 'name') : null
  const docStyles = parseDocumentStyles(docEl || dom)
  const annotations: Annotation[] = []
  walkKml(docEl || dom, [], annotations, docStyles)
  const geojson = toGeoJSON.kml(dom)
  return { geojson, docName, annotations }
}

const stripZ = (coords: any): any => {
  if (!Array.isArray(coords)) return coords
  if (coords.length === 0) return coords
  if (typeof coords[0] === 'number') return coords.length > 2 ? coords.slice(0, 2) : coords
  return coords.map(stripZ)
}

const normalizeGeometry = (geometry: any): any => {
  if (!geometry) return geometry
  if (geometry.type === 'GeometryCollection') {
    return {
      type: 'GeometryCollection',
      geometries: (geometry.geometries || []).map(normalizeGeometry),
    }
  }
  if (geometry.coordinates == null) return geometry
  return { ...geometry, coordinates: stripZ(geometry.coordinates) }
}

const collectCoords = (geometry: any, cb: (coords: any) => void) => {
  if (!geometry) return
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries || []) collectCoords(g, cb)
    return
  }
  if (geometry.coordinates != null) cb(geometry.coordinates)
}

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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const lower = file.name.toLowerCase()
    let geojson: any
    let docName: string | null = null
    let annotations: Annotation[] = []

    if (lower.endsWith('.kmz')) {
      const buf = await file.arrayBuffer()
      const kmlText = await extractKmlFromKmz(buf)
      ;({ geojson, docName, annotations } = parseKml(kmlText))
    } else if (lower.endsWith('.kml')) {
      const text = await file.text()
      ;({ geojson, docName, annotations } = parseKml(text))
    } else if (lower.endsWith('.geojson')) {
      geojson = JSON.parse(await file.text())
    } else if (lower.endsWith('.csv')) {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) return NextResponse.json({ error: 'CSV is empty' }, { status: 400 })
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      const latIdx = headers.findIndex(h => /^lat(itude)?$/i.test(h))
      const lngIdx = headers.findIndex(h => /^(lon|lng|long)(itude)?$/i.test(h))
      if (latIdx === -1 || lngIdx === -1) return NextResponse.json({ error: 'CSV needs latitude and longitude columns' }, { status: 400 })
      const features = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
        const lat = parseFloat(cols[latIdx]), lng = parseFloat(cols[lngIdx])
        if (isNaN(lat) || isNaN(lng)) return null
        const props: any = {}
        headers.forEach((h, i) => { if (i !== latIdx && i !== lngIdx && cols[i]) props[h] = cols[i] })
        return { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] }, properties: props }
      }).filter(Boolean)
      geojson = { type: 'FeatureCollection', features }
      docName = file.name.replace(/\.csv$/i, '')
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Use .kml, .kmz, .geojson, or .csv' }, { status: 400 })
    }

    if (!geojson?.features?.length) {
      return NextResponse.json({ error: 'No features found in file' }, { status: 400 })
    }

    const datasetName = docName || file.name.replace(/\.(kml|kmz|geojson)$/i, '')
    const { data: datasetRow, error: dsErr } = await supabase
      .from('datasets')
      .insert({ name: datasetName, source_file: file.name, feature_count: 0 })
      .select('id')
      .single()
    if (dsErr || !datasetRow) {
      console.error('Dataset insert error:', dsErr)
      return NextResponse.json({ error: 'Failed to create dataset' }, { status: 500 })
    }
    const datasetId = datasetRow.id

    const rows: any[] = []
    const bboxRef: { current: Bbox | null } = { current: null }
    geojson.features.forEach((feature: any, idx: number) => {
      if (!feature.geometry) return
      const geometry = normalizeGeometry(feature.geometry)
      const properties = { ...(feature.properties || {}) }
      const ann = annotations[idx]
      if (ann) {
        properties.__folder = ann.folder
        if (ann.color) properties.__color = ann.color
      }
      collectCoords(geometry, (c) => { bboxRef.current = extendBbox(bboxRef.current, c) })
      const lengthKm = geomLengthKm(geometry)
      rows.push({
        dataset_id: datasetId,
        type: properties.type || geometry.type,
        name: properties.name || properties.Name || null,
        geometry,
        properties,
        length_km: lengthKm > 0 ? parseFloat(lengthKm.toFixed(3)) : null,
      })
    })

    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from('assets').insert(rows.slice(i, i + CHUNK))
      if (error) {
        console.error('Insert error:', error)
        await supabase.from('datasets').delete().eq('id', datasetId)
        return NextResponse.json({ error: 'Failed to insert features' }, { status: 500 })
      }
    }

    const bbox = bboxRef.current
    const centroid = bbox
      ? { lng: (bbox.minLng + bbox.maxLng) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 }
      : null
    await supabase
      .from('datasets')
      .update({ feature_count: rows.length, bbox, centroid })
      .eq('id', datasetId)

    return NextResponse.json({
      message: `Imported ${rows.length} features into "${datasetName}"`,
      dataset: { id: datasetId, name: datasetName, feature_count: rows.length },
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
