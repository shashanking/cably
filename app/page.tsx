'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapComponent, { GeoLayer, MapFilter } from '../components/MapComponent'
import MapLoadingOverlay, { LoadState } from '../components/MapLoadingOverlay'
import { getOwnerValue } from '../lib/styling'

/* ── COLOR MAP UTILS ── */
const CAT_COLORS = ['#2563EB','#F59E0B','#059669','#dc2626','#7c3aed','#0891b2','#ea580c','#6366f1','#be185d','#65a30d','#0ea5e9','#db2777']
const GRAD_RAMPS = [['#E0F2FE','#0369A1'],['#DCFCE7','#166534'],['#FEF9C3','#A16207'],['#F3E8FF','#7E22CE'],['#FFE4E6','#BE123C'],['#FFF7ED','#C2410C']]
type ColorMap = { mode: 'categorical'; field: string; map: Record<string,string>; counts: Record<string,number> } | { mode: 'graduated'; field: string; min: number; max: number; c1: string; c2: string }
function buildColorMap(features: GeoJSON.Feature[], field: string, mode: 'categorical'|'graduated', layerId: string): ColorMap|null {
  const vals = features.map(f => (f.properties as any)?.[field]).filter((v:any) => v != null && v !== '')
  if (!vals.length) return null
  if (mode === 'categorical') { const unique = [...new Set(vals.map((v:any)=>String(v)))].slice(0,CAT_COLORS.length); const counts:Record<string,number>={}; vals.forEach((v:any)=>{const k=String(v);counts[k]=(counts[k]||0)+1}); return { mode:'categorical', field, map:Object.fromEntries(unique.map((v,i)=>[v,CAT_COLORS[i]])), counts } }
  else { const nums = vals.map((v:any)=>parseFloat(v)).filter((v:number)=>!isNaN(v)); if (!nums.length) return null; const idx = parseInt(layerId)%GRAD_RAMPS.length||0; return { mode:'graduated', field, min:Math.min(...nums), max:Math.max(...nums), c1:GRAD_RAMPS[idx][0], c2:GRAD_RAMPS[idx][1] } }
}
type LayerData = GeoLayer & { fillAttr?: string|null; colorMap?: ColorMap|null }

/* ── LAYER TYPE CONFIG ── */
const LAYER_TYPES: Record<string, { label: string; color: string }> = {
  owned: { label: 'Owned Fiber', color: '#2563EB' },
  leased: { label: 'Dark Fiber Lease', color: '#F59E0B' },
  waves: { label: 'Waves / Lit', color: '#7c3aed' },
  planned: { label: 'Planned Routes', color: '#059669' },
  pops: { label: 'POPs', color: '#dc2626' },
  wirecenters: { label: 'Wire Centers', color: '#0891b2' },
  colo: { label: 'Co-Lo', color: '#ea580c' },
  datacenters: { label: 'Data Centers', color: '#6366f1' },
  other: { label: 'Other', color: '#e11d48' },
}
const AUTO_RULES = [
  { p: /own(ed)?[\s_-]?fib/i, t: 'owned' }, { p: /dark[\s_-]?fib|lease/i, t: 'leased' },
  { p: /wave|lit[\s_-]?cap/i, t: 'waves' }, { p: /plan|desired|future/i, t: 'planned' },
  { p: /\bpop\b|point.of.pres/i, t: 'pops' }, { p: /wire.?cent|switch/i, t: 'wirecenters' },
  { p: /co.?lo|coloc/i, t: 'colo' }, { p: /data.?cent|dc[\s_-]/i, t: 'datacenters' },
]
function autoType(name: string) { for (const r of AUTO_RULES) if (r.p.test(name)) return r.t; return 'other' }
function detectGeomType(gj: GeoJSON.FeatureCollection) {
  const c: Record<string, number> = {}
  gj.features.forEach(f => { const t = (f.geometry?.type || 'Unknown').replace('Multi', ''); c[t] = (c[t] || 0) + 1 })
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown'
}

/* ── KML PARSING ── */
function kmlColor(c: string | null): string | null { if (!c || c.length < 8) return null; return '#' + c.slice(6, 8) + c.slice(4, 6) + c.slice(2, 4) }
function parseCoords(str: string): number[][] {
  if (!str) return []; return str.trim().split(/[\s\n\r]+/).map(c => { const p = c.split(',').map(Number); return (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) ? p.slice(0, 3) : null }).filter(Boolean) as number[][]
}
function childText(el: Element, tag: string): string { for (let i = 0; i < el.children.length; i++) { if (el.children[i].localName?.toLowerCase() === tag.toLowerCase()) return el.children[i].textContent?.trim() || '' } return '' }
function getChild(el: Element, tag: string): Element | null { const t = tag.toLowerCase(); for (let i = 0; i < el.children.length; i++) { if (el.children[i].localName?.toLowerCase() === t) return el.children[i] } return null }
function parseKMLStyles(doc: Document): Record<string, { color: string | null }> {
  const s: Record<string, { color: string | null }> = {}
  doc.querySelectorAll('Style[id]').forEach(el => { const id = el.getAttribute('id')!; const lc = kmlColor(el.querySelector('LineStyle color')?.textContent ?? null); const pc = kmlColor(el.querySelector('PolyStyle color')?.textContent ?? null); s[id] = { color: lc || pc || null } })
  doc.querySelectorAll('StyleMap[id]').forEach(sm => { const id = sm.getAttribute('id')!; const norm = [...sm.querySelectorAll('Pair')].find(p => p.querySelector('key')?.textContent === 'normal'); if (norm) { const ref = norm.querySelector('styleUrl')?.textContent?.replace('#', ''); if (ref && s[ref]) s[id] = s[ref] } })
  return s
}
function parseGeom(el: Element): GeoJSON.Geometry | null {
  const pt = getChild(el, 'Point'); if (pt) { const c = parseCoords(pt.querySelector('coordinates')?.textContent || ''); if (c.length) return { type: 'Point', coordinates: c[0] } }
  const ls = getChild(el, 'LineString'); if (ls) { const c = parseCoords(ls.querySelector('coordinates')?.textContent || ''); if (c.length > 1) return { type: 'LineString', coordinates: c } }
  const poly = getChild(el, 'Polygon'); if (poly) { const oc = poly.querySelector('outerBoundaryIs coordinates, outerBoundaryIs LinearRing coordinates'); if (oc) { const rings = [parseCoords(oc.textContent || '')]; poly.querySelectorAll('innerBoundaryIs coordinates, innerBoundaryIs LinearRing coordinates').forEach(ir => rings.push(parseCoords(ir.textContent || ''))); return { type: 'Polygon', coordinates: rings } } }
  const mg = getChild(el, 'MultiGeometry'); if (mg) { const geoms: GeoJSON.Geometry[] = []; for (let i = 0; i < mg.children.length; i++) { const child = mg.children[i]; const tag = child.localName?.toLowerCase(); if (tag === 'point') { const c = parseCoords(child.querySelector('coordinates')?.textContent || ''); if (c.length) geoms.push({ type: 'Point', coordinates: c[0] }) } else if (tag === 'linestring') { const c = parseCoords(child.querySelector('coordinates')?.textContent || ''); if (c.length > 1) geoms.push({ type: 'LineString', coordinates: c }) } else if (tag === 'polygon') { const oc = child.querySelector('outerBoundaryIs coordinates, outerBoundaryIs LinearRing coordinates'); if (oc) geoms.push({ type: 'Polygon', coordinates: [parseCoords(oc.textContent || '')] }) } } if (geoms.length === 1) return geoms[0]; if (geoms.length > 1) return { type: 'GeometryCollection', geometries: geoms } }
  return null
}
function parsePM(pm: Element, styles: Record<string, { color: string | null }>): GeoJSON.Feature | null {
  const name = childText(pm, 'name'), desc = childText(pm, 'description'), styleId = childText(pm, 'styleUrl').replace('#', '')
  const props: any = { name, _desc: desc, _styleId: styleId }
  if (styles[styleId]?.color) props._color = styles[styleId].color
  const ext = pm.querySelector('ExtendedData')
  if (ext) { ext.querySelectorAll('Data').forEach(d => { const k = d.getAttribute('name'); const v = d.querySelector('value')?.textContent || ''; if (k) props[k] = v }); ext.querySelectorAll('SimpleData').forEach(d => { const k = d.getAttribute('name'); if (k) props[k] = d.textContent || '' }) }
  const inlineStyle = pm.querySelector(':scope > Style')
  if (inlineStyle) { for (const tag of ['LineStyle', 'PolyStyle', 'IconStyle']) { const colorEl = inlineStyle.querySelector(`${tag} color`); if (colorEl?.textContent) { const hex = kmlColor(colorEl.textContent.trim()); if (hex) { props._color = hex; break } } } }
  const geom = parseGeom(pm); return geom ? { type: 'Feature', geometry: geom, properties: props } : null
}
function kmlToLayers(doc: Document, filename: string) {
  const styles = parseKMLStyles(doc); const result: { name: string; geojson: GeoJSON.FeatureCollection }[] = []; const root = doc.querySelector('Document') || doc.documentElement
  function processContainer(container: Element, prefix: string) { const dpm = Array.from(container.children).filter(c => c.localName?.toLowerCase() === 'placemark'); if (dpm.length > 0) { const features = dpm.map(pm => parsePM(pm, styles)).filter(Boolean) as GeoJSON.Feature[]; if (features.length > 0) result.push({ name: prefix, geojson: { type: 'FeatureCollection', features } }) } Array.from(container.children).filter(c => c.localName?.toLowerCase() === 'folder').forEach(folder => { const fn = childText(folder, 'name') || 'Layer'; processContainer(folder, prefix ? `${prefix} / ${fn}` : fn) }) }
  const topFolders = Array.from(root.children).filter(c => c.localName?.toLowerCase() === 'folder'); const rootPMs = Array.from(root.children).filter(c => c.localName?.toLowerCase() === 'placemark')
  if (topFolders.length > 0) { if (rootPMs.length > 0) { const features = rootPMs.map(pm => parsePM(pm, styles)).filter(Boolean) as GeoJSON.Feature[]; if (features.length > 0) result.push({ name: childText(root, 'name') || filename, geojson: { type: 'FeatureCollection', features } }) } topFolders.forEach(folder => processContainer(folder, childText(folder, 'name') || 'Layer')) } else { const allPMs = doc.querySelectorAll('Placemark'); const features = Array.from(allPMs).map(pm => parsePM(pm, styles)).filter(Boolean) as GeoJSON.Feature[]; if (features.length > 0) result.push({ name: childText(root, 'name') || filename, geojson: { type: 'FeatureCollection', features } }) }
  if (result.length === 0) { const allPMs = doc.querySelectorAll('Placemark'); const features = Array.from(allPMs).map(pm => parsePM(pm, styles)).filter(Boolean) as GeoJSON.Feature[]; if (features.length > 0) result.push({ name: filename, geojson: { type: 'FeatureCollection', features } }) }
  return result
}
async function parseKMLFile(file: File) { const doc = new DOMParser().parseFromString(await file.text(), 'application/xml'); return kmlToLayers(doc, file.name.replace(/\.kml$/i, '')) }
async function parseKMZFile(file: File) { const JSZip = (await import('jszip')).default; const zip = await JSZip.loadAsync(file); const entry = Object.values(zip.files).find(f => !f.dir && f.name.toLowerCase().endsWith('.kml')); if (!entry) throw new Error('No KML inside KMZ'); const doc = new DOMParser().parseFromString(await entry.async('text'), 'application/xml'); return kmlToLayers(doc, file.name.replace(/\.kmz$/i, '')) }
async function parseGeoJSONFile(file: File) { const gj = JSON.parse(await file.text()); const fc = gj.type === 'FeatureCollection' ? gj : { type: 'FeatureCollection' as const, features: [gj.type === 'Feature' ? gj : { type: 'Feature', geometry: gj, properties: {} }] }; return [{ name: file.name.replace(/\.(geo)?json$/i, ''), geojson: fc }] }

/* ── GEODESY ── */
function haversineKm(c1: number[], c2: number[]) { const R = 6371, toRad = (d: number) => d * Math.PI / 180; const dLat = toRad(c2[1] - c1[1]), dLon = toRad(c2[0] - c1[0]); const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(c1[1])) * Math.cos(toRad(c2[1])) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) }
function geomLengthKm(g: any): number { if (!g) return 0; if (g.type === 'LineString') { let km = 0; for (let i = 0; i < g.coordinates.length - 1; i++) km += haversineKm(g.coordinates[i], g.coordinates[i + 1]); return km } if (g.type === 'MultiLineString') return g.coordinates.reduce((s: number, l: number[][]) => { let km = 0; for (let i = 0; i < l.length - 1; i++) km += haversineKm(l[i], l[i + 1]); return s + km }, 0); if (g.type === 'GeometryCollection') return (g.geometries || []).reduce((s: number, gg: any) => s + geomLengthKm(gg), 0); return 0 }

/* ── STATE ── */
interface FileGroup { id: number; filename: string; expanded: boolean; visible: boolean; layers: LayerData[] }
interface FeatureInfo { feature: GeoJSON.Feature; color: string; layerId: string; layerName: string }
interface ToastItem { id: number; msg: string; type: string }
let gid = 1, lid = 1, tid = 1

/* ── MAIN ── */
export default function Home() {
  const [groups, setGroups] = useState<FileGroup[]>([])
  const [sideTab, setSideTab] = useState<'layers' | 'filters' | 'charts'>('layers')
  // basemap handled by Google Maps built-in controls
  const [featureInfo, setFeatureInfo] = useState<FeatureInfo | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<GeoJSON.Feature | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [attrTable, setAttrTable] = useState<{ layerId: string; layerName: string } | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([])
  const [hiddenVendors, setHiddenVendors] = useState<Set<string>>(new Set())
  const [hiddenOwners, setHiddenOwners] = useState<Set<string>>(new Set())
  const [colorMode, setColorMode] = useState<'layer' | 'vendor' | 'owner'>('layer')
  const [loadState, setLoadState] = useState<LoadState>({
    stage: 'idle', datasetsTotal: 0, datasetsDone: 0,
    featuresTotal: 0, featuresPlotted: 0, attrsIndexed: 0,
  })

  const showToast = useCallback((msg: string, type = 'success') => {
    const id = tid++; setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000)
  }, [])

  const totalFeats = useMemo(() => groups.reduce((s, g) => s + g.layers.reduce((ss, l) => ss + l.count, 0), 0), [groups])
  const totalLayers = useMemo(() => groups.reduce((s, g) => s + g.layers.length, 0), [groups])
  const allLayers = useMemo(() => groups.flatMap(g => g.layers.map(l => ({ ...l, visible: l.visible && g.visible }))), [groups])

  /* Load saved datasets from DB */
  const [savedDatasets, setSavedDatasets] = useState<{ id: number; name: string; feature_count: number }[]>([])
  const [loadedDatasetIds, setLoadedDatasetIds] = useState<Set<number>>(new Set())

  const refreshDatasets = useCallback(async () => {
    try { const d = await fetch('/api/datasets').then(r => r.json()); if (Array.isArray(d)) setSavedDatasets(d) } catch {}
  }, [])

  const loadFromDB = useCallback(async (ds: { id: number; name: string; feature_count: number }) => {
    if (loadedDatasetIds.has(ds.id)) return
    setLoading(true)
    try {
      const assets = await fetch(`/api/assets?dataset_id=${ds.id}`).then(r => r.json())
      if (!Array.isArray(assets) || !assets.length) { showToast('No features in dataset', 'warn'); setLoading(false); return }
      const features: GeoJSON.Feature[] = assets.map((a: any) => ({ type: 'Feature' as const, geometry: a.geometry, properties: { ...a.properties, name: a.name || a.properties?.name, _color: a.properties?.__color || a.properties?._color } }))
      const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
      const groupId = gid++
      const layer: LayerData = { id: String(lid++), name: ds.name, color: LAYER_TYPES[autoType(ds.name)].color, visible: true, geojson, geomType: detectGeomType(geojson), count: features.length, fillAttr: null, colorMap: null }
      setGroups(prev => [...prev, { id: groupId, filename: `📂 ${ds.name}`, expanded: true, visible: true, layers: [layer] }])
      setLoadedDatasetIds(prev => new Set(prev).add(ds.id))
      showToast(`Loaded "${ds.name}" — ${features.length} features`)
    } catch (e: any) { showToast(`Failed to load: ${e.message}`, 'error') }
    setLoading(false)
  }, [loadedDatasetIds, showToast])

  /* Auto-load all saved datasets on mount — parallelized + staged overlay */
  useEffect(() => {
    let mounted = true
    async function autoLoad() {
      setLoadState(s => ({ ...s, stage: 'connecting', currentLabel: 'Opening secure channel to datastore…' }))
      try {
        const [datasets, vendorList] = await Promise.all([
          fetch('/api/datasets').then(r => r.json()).catch(() => []),
          fetch('/api/vendors').then(r => r.json()).catch(() => []),
        ])
        if (!mounted) return
        if (Array.isArray(vendorList)) setVendors(vendorList)
        if (!Array.isArray(datasets) || datasets.length === 0) {
          setLoadState(s => ({ ...s, stage: 'done' }))
          return
        }
        setSavedDatasets(datasets)
        setLoadState(s => ({
          ...s, stage: 'fetching', datasetsTotal: datasets.length,
          currentLabel: `Queued ${datasets.length} dataset${datasets.length !== 1 ? 's' : ''}`,
        }))

        let done = 0
        let featuresTotal = 0
        let attrsIndexed = 0

        // Fetch all datasets in parallel — the DB/API is the bottleneck.
        const results = await Promise.all(
          datasets.map(async (ds: any) => {
            try {
              const assets = await fetch(`/api/assets?dataset_id=${ds.id}`).then(r => r.json())
              done += 1
              if (!mounted) return null
              setLoadState(s => ({
                ...s, stage: 'fetching', datasetsDone: done,
                currentLabel: `Fetched "${ds.name}" (${Array.isArray(assets) ? assets.length : 0})`,
              }))
              return { ds, assets }
            } catch {
              done += 1
              setLoadState(s => ({ ...s, datasetsDone: done }))
              return null
            }
          })
        )
        if (!mounted) return

        // Parse / index stage
        setLoadState(s => ({ ...s, stage: 'parsing', currentLabel: 'Indexing attributes…' }))
        const groupsToAdd: FileGroup[] = []
        const idsToMark: number[] = []
        for (const r of results) {
          if (!r || !Array.isArray(r.assets) || r.assets.length === 0) continue
          const features: GeoJSON.Feature[] = r.assets.map((a: any) => ({
            type: 'Feature' as const,
            geometry: a.geometry,
            properties: {
              ...a.properties,
              name: a.name || a.properties?.name,
              _color: a.properties?.__color || a.properties?._color,
              vendor_id: a.vendor_id ?? null,
              status: a.status ?? a.properties?.status,
            },
          }))
          attrsIndexed += features.reduce((s, f) => s + Object.keys(f.properties || {}).length, 0)
          featuresTotal += features.length
          const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
          const groupId = gid++
          const layer: LayerData = {
            id: String(lid++), name: r.ds.name,
            color: LAYER_TYPES[autoType(r.ds.name)].color,
            visible: true, geojson, geomType: detectGeomType(geojson),
            count: features.length, fillAttr: null, colorMap: null,
          }
          groupsToAdd.push({ id: groupId, filename: r.ds.name, expanded: true, visible: true, layers: [layer] })
          idsToMark.push(r.ds.id)
        }

        setLoadState(s => ({
          ...s, stage: 'projecting', featuresTotal, attrsIndexed,
          currentLabel: `Projecting ${featuresTotal.toLocaleString()} features to WGS84…`,
        }))

        // Commit all at once — avoids N re-renders.
        if (mounted && groupsToAdd.length > 0) {
          setGroups(prev => [...prev, ...groupsToAdd])
          setLoadedDatasetIds(prev => { const s = new Set(prev); idsToMark.forEach(id => s.add(id)); return s })
        }

        setLoadState(s => ({ ...s, stage: 'rendering', currentLabel: 'Rasterizing overlays on canvas…' }))
      } catch {
        setLoadState(s => ({ ...s, stage: 'done' }))
      }
    }
    autoLoad()
    return () => { mounted = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When the map finishes plotting, close the overlay.
  const onRenderProgress = useCallback((p: { featuresPlotted: number; featuresTotal: number }) => {
    setLoadState(s => {
      const newTotal = Math.max(s.featuresTotal, p.featuresTotal)
      const shouldFinish = s.stage === 'rendering' && p.featuresTotal > 0 && p.featuresPlotted >= p.featuresTotal
      // No-op when nothing changed — avoids re-render loops.
      if (!shouldFinish && s.featuresPlotted === p.featuresPlotted && s.featuresTotal === newTotal) return s
      const next = { ...s, featuresPlotted: p.featuresPlotted, featuresTotal: newTotal }
      if (shouldFinish) return { ...next, stage: 'done', currentLabel: 'Ready.' }
      return next
    })
  }, [])

  /* File handling — upload to DB + show on map */
  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['kml', 'kmz', 'geojson', 'json', 'csv'].includes(ext || '')) { showToast(`Unsupported format: .${ext}`, 'warn'); return }
    setLoading(true)
    try {
      // 1. Upload to database via API
      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed')

      // 2. Parse client-side for immediate map display
      let layerDefs: { name: string; geojson: GeoJSON.FeatureCollection }[]
      if (ext === 'kml') layerDefs = await parseKMLFile(file)
      else if (ext === 'kmz') layerDefs = await parseKMZFile(file)
      else if (ext === 'geojson' || ext === 'json') layerDefs = await parseGeoJSONFile(file)
      else layerDefs = [] // CSV handled server-side only

      if (layerDefs.length > 0) {
        const groupId = gid++
        const dsId = uploadData.dataset?.id
        const items: LayerData[] = layerDefs.map(def => ({ id: String(lid++), name: def.name, color: LAYER_TYPES[autoType(def.name)].color, visible: true, geojson: def.geojson, geomType: detectGeomType(def.geojson), count: def.geojson.features.length, fillAttr: null, colorMap: null }))
        setGroups(prev => [...prev, { id: groupId, filename: file.name, expanded: true, visible: true, layers: items }])
        if (dsId) setLoadedDatasetIds(prev => new Set(prev).add(dsId))
      } else if (uploadData.dataset) {
        // For CSV or fallback: reload from DB
        await loadFromDB(uploadData.dataset)
      }

      // 3. Refresh saved datasets list
      refreshDatasets()
      const fc = uploadData.dataset?.feature_count || 0
      showToast(`${file.name} — ${fc} features saved to database & displayed on map`)
    } catch (e: any) { showToast(`${file.name}: ${e.message}`, 'error') }
    setLoading(false)
  }, [showToast, loadFromDB, refreshDatasets])

  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); [...e.dataTransfer.files].forEach(processFile) }, [processFile])
  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { [...(e.target.files || [])].forEach(processFile); e.target.value = '' }, [processFile])

  /* Actions */
  const toggleGroup = (id: number) => setGroups(p => p.map(g => g.id === id ? { ...g, visible: !g.visible } : g))
  const expandGroup = (id: number) => setGroups(p => p.map(g => g.id === id ? { ...g, expanded: !g.expanded } : g))
  const removeGroup = (id: number) => setGroups(p => p.filter(g => g.id !== id))
  const toggleLayer = (id: string) => setGroups(p => p.map(g => ({ ...g, layers: g.layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l) })))
  const removeLayer = (id: string) => setGroups(p => p.map(g => ({ ...g, layers: g.layers.filter(l => l.id !== id) })).filter(g => g.layers.length > 0))
  const changeLayerColor = (id: string, color: string) => setGroups(p => p.map(g => ({ ...g, layers: g.layers.map(l => l.id === id ? { ...l, color } : l) })))
  const applyFillAttr = (id: string, field: string, mode: 'categorical' | 'graduated') => { setGroups(p => p.map(g => ({ ...g, layers: g.layers.map(l => { if (l.id !== id) return l; if (!field) return { ...l, fillAttr: null, colorMap: null }; const cm = buildColorMap(l.geojson.features, field, mode, l.id); return cm ? { ...l, fillAttr: field, colorMap: cm } : l }) }))) }
  const resetFillAttr = (id: string) => setGroups(p => p.map(g => ({ ...g, layers: g.layers.map(l => l.id === id ? { ...l, fillAttr: null, colorMap: null } : l) })))
  const clearAll = () => { setGroups([]); setFeatureInfo(null); setAttrTable(null) }

  const getLayerFields = (l: LayerData) => { const SKIP = new Set(['_desc', '_styleId', '_color']); const f = l.geojson.features[0]; if (!f) return []; return Object.keys(f.properties || {}).filter(k => !SKIP.has(k) && !k.startsWith('_')) }
  const findLayer = (id: string) => groups.flatMap(g => g.layers).find(l => l.id === id)

  /* Derived: owner + vendor facets across all loaded features */
  const facets = useMemo(() => {
    const ownerCounts = new Map<string, number>()
    const vendorCounts = new Map<string, number>()
    let noOwner = 0
    let noVendor = 0
    groups.forEach(g => g.layers.forEach(l => l.geojson.features.forEach(f => {
      const o = getOwnerValue(f.properties) || ''
      if (o) ownerCounts.set(o, (ownerCounts.get(o) || 0) + 1); else noOwner++
      const vid = (f.properties as any)?.vendor_id
      const key = vid != null && vid !== '' ? String(vid) : ''
      if (key) vendorCounts.set(key, (vendorCounts.get(key) || 0) + 1); else noVendor++
    })))
    const owners = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])
    const vendorRows = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({
      id, name: vendors.find(v => String(v.id) === id)?.name || `Vendor #${id}`, count,
    }))
    return { owners, noOwner, vendorRows, noVendor }
  }, [groups, vendors])

  /* Stable color maps for vendor/owner styling modes */
  const mapFilter = useMemo<MapFilter>(() => {
    const palette = ['#2563EB','#059669','#F59E0B','#7c3aed','#dc2626','#0891b2','#ea580c','#be185d','#65a30d','#0ea5e9','#db2777','#6366f1','#14b8a6','#f43f5e']
    const vendorColorMap: Record<string, string> = {}
    facets.vendorRows.forEach((v, i) => { vendorColorMap[v.id] = palette[i % palette.length] })
    vendorColorMap['__none__'] = '#94a3b8'
    const ownerColorMap: Record<string, string> = {}
    facets.owners.forEach(([o], i) => { ownerColorMap[o] = palette[i % palette.length] })
    ownerColorMap['__none__'] = '#94a3b8'
    return { hiddenVendors, hiddenOwners, vendorColorMap, ownerColorMap, colorMode }
  }, [facets, hiddenVendors, hiddenOwners, colorMode])

  const toggleVendor = (id: string) => setHiddenVendors(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleOwner = (name: string) => setHiddenOwners(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s })
  const showOnlyVendor = (id: string) => { const all = new Set<string>([...facets.vendorRows.map(v => v.id), '__none__']); all.delete(id); setHiddenVendors(all) }
  const showOnlyOwner = (name: string) => { const all = new Set<string>([...facets.owners.map(([o]) => o), '__none__']); all.delete(name); setHiddenOwners(all) }
  const clearVendorFilter = () => setHiddenVendors(new Set())
  const clearOwnerFilter = () => setHiddenOwners(new Set())

  const geomBadge = (type: string) => {
    if (type === 'Point') return { cls: 'bg-teal-50 text-teal-600 border-teal-200', txt: 'PT' }
    if (type === 'LineString') return { cls: 'bg-blue-50 text-blue-600 border-blue-200', txt: 'LN' }
    if (type === 'Polygon') return { cls: 'bg-amber-50 text-amber-600 border-amber-200', txt: 'PG' }
    return { cls: 'bg-slate-50 text-slate-500 border-slate-200', txt: '??' }
  }

  /* Search across all features */
  const searchResults = useMemo(() => {
    if (!globalSearch.trim()) return null
    const q = globalSearch.toLowerCase()
    const results: { feature: GeoJSON.Feature; layerId: string; layerName: string; color: string }[] = []
    groups.forEach(g => g.layers.forEach(l => {
      l.geojson.features.forEach(f => {
        const vals = Object.values(f.properties || {}).map(v => String(v || '').toLowerCase())
        if (vals.some(v => v.includes(q))) results.push({ feature: f, layerId: l.id, layerName: l.name, color: l.color })
      })
    }))
    return results.slice(0, 50)
  }, [globalSearch, groups])

  return (
    <div className="flex h-[calc(100vh-52px)]">
      {/* ── SIDEBAR ── */}
      <aside className="w-[320px] min-w-[320px] bg-white border-r border-slate-200 flex flex-col overflow-hidden">
        {/* Search */}
        <div className="px-3 py-2 border-b border-slate-100">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search all features..." className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-blue-300 focus:bg-white" />
          </div>
          {searchResults && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {searchResults.length === 0 ? <div className="px-3 py-2 text-xs text-slate-400">No results</div> : searchResults.map((r, i) => (
                <div key={i} onClick={() => { setFeatureInfo({ feature: r.feature, color: r.color, layerId: r.layerId, layerName: r.layerName }); setSelectedFeature(r.feature); setGlobalSearch('') }} className="px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50 border-b border-slate-100 last:border-b-0 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                  <span className="font-medium text-slate-800 truncate">{(r.feature.properties as any)?.name || 'Unnamed'}</span>
                  <span className="text-slate-400 ml-auto text-[10px] shrink-0">{r.layerName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 shrink-0">
          {([
            { id: 'layers', label: 'Layers' },
            { id: 'filters', label: 'Filters' },
            { id: 'charts', label: 'Analytics' },
          ] as const).map(tab => (
            <button key={tab.id} onClick={() => setSideTab(tab.id)} className={`flex-1 py-2.5 text-[11px] font-semibold transition-all border-b-2 -mb-px uppercase tracking-wider ${sideTab === tab.id ? 'text-blue-600 border-blue-600 bg-blue-50/50' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>
              {tab.label}
              {tab.id === 'filters' && (hiddenVendors.size + hiddenOwners.size) > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold">{hiddenVendors.size + hiddenOwners.size}</span>
              )}
            </button>
          ))}
        </div>

        {/* LAYERS TAB */}
        {sideTab === 'layers' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="p-3 pb-0">
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer transition-all hover:border-blue-300 hover:bg-blue-50/30 group" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('!border-blue-400', '!bg-blue-50') }} onDragLeave={e => { e.currentTarget.classList.remove('!border-blue-400', '!bg-blue-50') }} onDrop={e => { e.currentTarget.classList.remove('!border-blue-400', '!bg-blue-50'); onDrop(e) }} onClick={() => document.getElementById('fileInput')?.click()}>
                <div className="text-2xl mb-1 group-hover:scale-110 transition-transform">📁</div>
                <div className="font-semibold text-sm text-slate-700">Drop files here</div>
                <div className="text-slate-400 text-[11px] mt-0.5">KML, KMZ, GeoJSON</div>
              </div>
              <input type="file" id="fileInput" multiple accept=".kml,.kmz,.geojson,.json" onChange={onFileSelect} className="hidden" />
            </div>

            {/* Saved Datasets from DB */}
            {savedDatasets.length > 0 && (
              <div className="px-3 py-2 border-t border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Saved Datasets</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {savedDatasets.map(ds => (
                    <button key={ds.id} onClick={() => loadFromDB(ds)} disabled={loadedDatasetIds.has(ds.id)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${loadedDatasetIds.has(ds.id) ? 'bg-emerald-50 text-emerald-600 cursor-default' : 'hover:bg-blue-50 text-slate-600 cursor-pointer'}`}>
                      <span>{loadedDatasetIds.has(ds.id) ? '✅' : '📂'}</span>
                      <span className="flex-1 truncate font-medium">{ds.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{ds.feature_count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{totalLayers} Layers &middot; {totalFeats.toLocaleString()} Features</span>
              {groups.length > 0 && <button onClick={clearAll} className="text-[10px] text-red-400 hover:text-red-600 font-medium">Clear All</button>}
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {groups.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                  <span className="text-4xl mb-3 opacity-40">🗺️</span>
                  <div className="text-sm font-medium text-slate-500 mb-1">No layers loaded</div>
                  <div className="text-xs">Upload files or load saved datasets</div>
                </div>
              )}
              {groups.map(g => (
                <div key={g.id} className="mb-2 rounded-xl border border-slate-200 overflow-hidden shadow-sm bg-white">
                  <div className="bg-slate-50 px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => expandGroup(g.id)}>
                    <svg className={`h-3 w-3 text-slate-400 transition-transform ${g.expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    <span className="text-sm">📂</span>
                    <span className="flex-1 text-xs font-semibold text-slate-700 truncate">{g.filename}</span>
                    <span className="text-[10px] text-slate-400 bg-slate-200/60 px-1.5 py-0.5 rounded-full font-mono">{g.layers.length}</span>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleGroup(g.id)} className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] transition-all ${g.visible ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`} title="Toggle">{g.visible ? '👁' : '👁‍🗨'}</button>
                      <button onClick={() => removeGroup(g.id)} className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500" title="Remove">✕</button>
                    </div>
                  </div>
                  {g.expanded && g.layers.map(l => {
                    const gb = geomBadge(l.geomType)
                    return <LayerRow key={l.id} layer={l} gb={gb} onToggle={() => toggleLayer(l.id)} onRemove={() => removeLayer(l.id)} onColorChange={c => changeLayerColor(l.id, c)} onApplyFill={(f, m) => applyFillAttr(l.id, f, m)} onResetFill={() => resetFillAttr(l.id)} onOpenTable={() => setAttrTable({ layerId: l.id, layerName: l.name })} fields={getLayerFields(l)} />
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FILTERS TAB */}
        {sideTab === 'filters' && (
          <FiltersPane
            vendorRows={facets.vendorRows}
            noVendor={facets.noVendor}
            owners={facets.owners}
            noOwner={facets.noOwner}
            hiddenVendors={hiddenVendors}
            hiddenOwners={hiddenOwners}
            colorMode={colorMode}
            setColorMode={setColorMode}
            toggleVendor={toggleVendor}
            toggleOwner={toggleOwner}
            showOnlyVendor={showOnlyVendor}
            showOnlyOwner={showOnlyOwner}
            clearVendorFilter={clearVendorFilter}
            clearOwnerFilter={clearOwnerFilter}
            vendorColorMap={mapFilter.vendorColorMap || {}}
            ownerColorMap={mapFilter.ownerColorMap || {}}
          />
        )}

        {/* CHARTS TAB */}
        {sideTab === 'charts' && <ChartsPane groups={groups} />}
      </aside>

      {/* ── MAP AREA ── */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        <div className="flex-1 relative">
          {loading && <div className="absolute inset-0 bg-white/60 z-[999] flex items-center justify-center"><div className="flex items-center gap-3 bg-white rounded-xl px-5 py-3 shadow-lg border border-slate-200"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /><span className="text-sm text-slate-600">Loading...</span></div></div>}
          <MapComponent
            layers={allLayers}
            selectedFeature={selectedFeature}
            filter={mapFilter}
            onRenderProgress={onRenderProgress}
            onFeatureClick={(f, c, ln) => { const layer = allLayers.find(l => l.geojson.features.includes(f)); setFeatureInfo({ feature: f, color: c, layerId: layer?.id || '', layerName: ln || layer?.name || '' }); setSelectedFeature(f) }}
          />
          <MapLoadingOverlay state={loadState} onDismiss={() => setLoadState(s => ({ ...s, stage: 'idle' }))} />
          {/* Layer color legend - always visible when layers loaded */}
          <LayerColorLegend groups={groups} />
          {/* Attribute fill legend */}
          <MapLegend groups={groups} />
        </div>

        {/* Feature info panel */}
        {featureInfo && <FeaturePanel info={featureInfo} onClose={() => setFeatureInfo(null)} />}

        {/* Attribute table */}
        {attrTable && <AttributeTable layerId={attrTable.layerId} layerName={attrTable.layerName} layer={findLayer(attrTable.layerId) || null} onClose={() => setAttrTable(null)} onSelectFeature={(f, c) => { setFeatureInfo({ feature: f, color: c, layerId: attrTable.layerId, layerName: attrTable.layerName }); setSelectedFeature(f) }} />}

        {/* Status bar */}
        <div className="h-6 bg-white border-t border-slate-200 flex items-center px-3 gap-4 shrink-0 text-[10px] text-slate-400 font-mono">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Ready</span>
          <span className="ml-auto">{totalLayers} layers &middot; {totalFeats.toLocaleString()} features</span>
        </div>
      </div>

      {/* Toasts */}
      <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    </div>
  )
}

/* ── LAYER ROW ── */
function LayerRow({ layer, gb, onToggle, onRemove, onColorChange, onApplyFill, onResetFill, onOpenTable, fields }: { layer: LayerData; gb: { cls: string; txt: string }; onToggle: () => void; onRemove: () => void; onColorChange: (c: string) => void; onApplyFill: (f: string, m: 'categorical' | 'graduated') => void; onResetFill: () => void; onOpenTable: () => void; fields: string[] }) {
  const [attrOpen, setAttrOpen] = useState(false)
  const [selField, setSelField] = useState(layer.fillAttr || '')
  const [selMode, setSelMode] = useState<'categorical' | 'graduated'>('categorical')
  const colorRef = useRef<HTMLInputElement>(null)

  return (
    <div className="border-t border-slate-100">
      <div className="px-3 py-2 flex items-center gap-2 hover:bg-slate-50/50 transition-colors">
        <div className="w-4 h-4 rounded-full shrink-0 cursor-pointer border-2 border-white shadow-sm hover:scale-125 transition-transform relative" style={{ background: layer.color }} onClick={() => colorRef.current?.click()}>
          <input ref={colorRef} type="color" value={layer.color} onChange={e => onColorChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
        </div>
        <span className={`text-[8px] font-bold font-mono px-1 py-0.5 rounded border ${gb.cls}`}>{gb.txt}</span>
        <span className="flex-1 text-xs text-slate-700 truncate font-medium" title={layer.name}>{layer.name}</span>
        <span className="text-[10px] text-slate-400 font-mono">{layer.count}</span>
        <div className="flex gap-0.5 shrink-0">
          <button onClick={onOpenTable} className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Attribute Table">📋</button>
          <button onClick={() => setAttrOpen(!attrOpen)} className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] transition-colors ${layer.fillAttr ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-500 hover:bg-violet-50 hover:text-violet-600'}`} title="Style by Attribute">🎨</button>
          <button onClick={onToggle} className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] transition-colors ${layer.visible ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>{layer.visible ? '👁' : '—'}</button>
          <button onClick={onRemove} className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500">✕</button>
        </div>
      </div>
      {attrOpen && (
        <div className="bg-slate-50 border-t border-slate-100 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-medium w-10 shrink-0">Field</span>
            <select value={selField} onChange={e => setSelField(e.target.value)} className="flex-1 rounded-md border border-slate-200 bg-white text-xs px-2 py-1 outline-none focus:border-blue-300">
              <option value="">— uniform —</option>{fields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-medium w-10 shrink-0">Mode</span>
            <div className="flex gap-1">{(['categorical', 'graduated'] as const).map(m => <button key={m} onClick={() => setSelMode(m)} className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-all ${selMode === m ? 'bg-violet-50 border-violet-200 text-violet-700' : 'border-slate-200 text-slate-500'}`}>{m}</button>)}</div>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => onApplyFill(selField, selMode)} className="flex-1 py-1 rounded-md bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition-colors">Apply</button>
            <button onClick={onResetFill} className="py-1 px-3 rounded-md border border-slate-200 text-xs text-slate-500 hover:bg-slate-100">Reset</button>
          </div>
          {layer.colorMap && (
            <div className="border-t border-slate-200 pt-2 space-y-1 max-h-24 overflow-y-auto">
              {layer.colorMap.mode === 'categorical' ? Object.entries(layer.colorMap.map).slice(0, 10).map(([val, color]) => (
                <div key={val} className="flex items-center gap-1.5 text-[10px] text-slate-600"><div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: String(color) }} /><span className="truncate flex-1">{val}</span><span className="text-slate-400 font-mono">{(layer.colorMap as any).counts?.[val]}</span></div>
              )) : <><div className="h-2 rounded" style={{ background: `linear-gradient(90deg, ${(layer.colorMap as any).c1}, ${(layer.colorMap as any).c2})` }} /><div className="flex justify-between text-[9px] text-slate-400 font-mono"><span>{(layer.colorMap as any).min?.toFixed(1)}</span><span>{(layer.colorMap as any).max?.toFixed(1)}</span></div></>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── FEATURE INFO PANEL ── */
function FeaturePanel({ info, onClose }: { info: FeatureInfo; onClose: () => void }) {
  const p = info.feature.properties as any || {}
  const name = p.name || p.Name || 'Feature'
  const geomType = info.feature.geometry?.type || '—'
  const length = geomLengthKm(info.feature.geometry)
  const owner = p.owner || p.maintainedby || null
  const status = p.Status || p.construction_status || p.stage || null
  const vendor = p.vendor || null
  const costPerKm = p.cost_per_km ? Number(p.cost_per_km) : null
  const totalCost = p.total_cost ? Number(p.total_cost) : (costPerKm && length > 0 ? costPerKm * length : null)
  const entries = Object.entries(p).filter(([k, v]) => !k.startsWith('_') && k !== 'styleUrl' && v != null && v !== '' && !['name','Name','owner','maintainedby','Status','construction_status','stage','vendor','cost_per_km','total_cost'].includes(k))

  return (
    <div className="absolute top-3 right-3 w-[340px] bg-white rounded-xl border border-slate-200 shadow-xl z-[900] overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 flex items-center gap-3 border-b border-slate-200">
        <div className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ background: info.color }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-slate-800 truncate">{name}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">{info.layerName}</span>
            <span className="text-[10px] text-slate-400 font-mono">{geomType}</span>
            {length > 0 && <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-mono font-medium">{length.toFixed(2)} km</span>}
          </div>
        </div>
        <button onClick={onClose} className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-200 hover:text-slate-600 text-sm" title="Close panel">×</button>
      </div>

      {/* Quick info cards */}
      {(owner || status || vendor || totalCost) && (
        <div className="px-3 py-2 border-b border-slate-100 grid grid-cols-2 gap-2">
          {owner && <div className="bg-slate-50 rounded-lg px-2 py-1.5"><div className="text-[8px] text-slate-400 uppercase font-bold">Owner</div><div className="text-xs text-slate-700 font-medium truncate">{owner}</div></div>}
          {status && <div className="bg-slate-50 rounded-lg px-2 py-1.5"><div className="text-[8px] text-slate-400 uppercase font-bold">Status</div><div className="text-xs text-slate-700 font-medium">{status}</div></div>}
          {vendor && <div className="bg-slate-50 rounded-lg px-2 py-1.5"><div className="text-[8px] text-slate-400 uppercase font-bold">Vendor</div><div className="text-xs text-blue-600 font-medium truncate">{vendor}</div></div>}
          {totalCost != null && <div className="bg-amber-50 rounded-lg px-2 py-1.5"><div className="text-[8px] text-amber-600 uppercase font-bold">Est. Cost</div><div className="text-xs text-amber-700 font-bold font-mono">${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>}
        </div>
      )}

      <div className="max-h-[200px] overflow-y-auto p-3 space-y-1">
        {entries.length === 0 ? <div className="text-xs text-slate-400 text-center py-3">No additional properties</div> : entries.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1 border-b border-slate-100 last:border-b-0">
            <span className="text-[9px] text-slate-400 w-20 shrink-0 font-mono uppercase">{k}</span>
            <span className="text-[11px] text-slate-700 break-all flex-1">{String(v).slice(0, 200)}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50">
        <p className="text-[9px] text-slate-400 italic">Click features on the map to inspect. Use 📋 in sidebar to open the full attribute table.</p>
      </div>
    </div>
  )
}

/* ── ATTRIBUTE TABLE ── */
function AttributeTable({ layerId, layerName, layer, onClose, onSelectFeature }: { layerId: string; layerName: string; layer: LayerData | null; onClose: () => void; onSelectFeature: (f: GeoJSON.Feature, c: string) => void }) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState(1)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  if (!layer) return null

  const SKIP = new Set(['_desc', '_styleId', '_color'])
  const cols = new Set<string>(); layer.geojson.features.forEach(f => Object.keys(f.properties || {}).forEach(k => { if (!SKIP.has(k) && !k.startsWith('_')) cols.add(k) }))
  const colList = ['#', ...Array.from(cols)]

  let rows = layer.geojson.features.map((f, i) => ({ idx: i, feature: f, num: i + 1 }))
  if (search.trim()) { const q = search.toLowerCase(); rows = rows.filter(r => Object.values(r.feature.properties || {}).some(v => String(v || '').toLowerCase().includes(q))) }
  if (sortCol && sortCol !== '#') { rows = [...rows].sort((a, b) => { const va = (a.feature.properties as any)?.[sortCol!] ?? ''; const vb = (b.feature.properties as any)?.[sortCol!] ?? ''; const na = parseFloat(va), nb = parseFloat(vb); if (!isNaN(na) && !isNaN(nb)) return (na - nb) * sortDir; return String(va).localeCompare(String(vb)) * sortDir }) }

  const handleSort = (col: string) => { if (col === '#') return; if (sortCol === col) setSortDir(d => d * -1); else { setSortCol(col); setSortDir(1) } }

  return (
    <div className="bg-white border-t-2 border-blue-200 flex flex-col max-h-[40vh] shadow-lg z-[950]">
      <div className="px-4 py-2 bg-slate-50 flex items-center gap-3 border-b border-slate-200 shrink-0">
        <span className="text-sm">📋</span>
        <span className="font-semibold text-sm text-slate-800 flex-1 truncate">{layerName}</span>
        <span className="text-[10px] text-slate-400 font-mono bg-slate-200/60 px-2 py-0.5 rounded-full">{rows.length} / {layer.count}</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-40 rounded-md border border-slate-200 bg-white text-xs px-2 py-1 outline-none focus:border-blue-300" />
        <span className="text-[10px] text-slate-400 italic">Click row to inspect</span>
        <button onClick={onClose} className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-200 hover:text-slate-600">✕</button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="attr-table">
          <thead><tr>{colList.slice(0, 15).map(c => <th key={c} className={c === sortCol ? (sortDir === 1 ? 'sort-asc' : 'sort-desc') : ''} onClick={() => handleSort(c)}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={colList.length} className="text-center py-6 text-slate-400">No matches</td></tr>}
            {rows.slice(0, 500).map(r => (
              <tr key={r.idx} className={selectedIdx === r.idx ? 'selected' : ''} onClick={() => { setSelectedIdx(r.idx); onSelectFeature(r.feature, layer.color) }}>
                <td className="row-num">{r.num}</td>
                {Array.from(cols).slice(0, 14).map(c => <td key={c} title={String((r.feature.properties as any)?.[c] ?? '')}>{String((r.feature.properties as any)?.[c] ?? '').slice(0, 80)}</td>)}
              </tr>
            ))}
            {rows.length > 500 && <tr><td colSpan={colList.length} className="text-center py-2 text-[10px] text-slate-400">Showing 500 of {rows.length}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── LAYER COLOR LEGEND (always visible) ── */
function LayerColorLegend({ groups }: { groups: FileGroup[] }) {
  const visibleLayers = groups.flatMap(g => g.visible ? g.layers.filter(l => l.visible) : [])
  if (!visibleLayers.length) return null
  return (
    <div className="absolute top-3 left-3 z-[900] bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl p-3 min-w-[180px] max-w-[240px] max-h-[300px] overflow-y-auto shadow-lg">
      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Layers</div>
      {visibleLayers.map(l => (
        <div key={l.id} className="flex items-center gap-2 py-1 border-b border-slate-100 last:border-b-0">
          <div className="shrink-0" style={{ width: l.geomType === 'Point' ? 10 : 18, height: l.geomType === 'Point' ? 10 : 4, borderRadius: l.geomType === 'Point' ? '50%' : 2, background: l.color }} />
          <span className="text-[11px] text-slate-700 truncate flex-1 font-medium" title={l.name}>{l.name}</span>
          <span className="text-[9px] text-slate-400 font-mono shrink-0">{l.count}</span>
        </div>
      ))}
    </div>
  )
}

/* ── ATTRIBUTE FILL LEGEND ── */
function MapLegend({ groups }: { groups: FileGroup[] }) {
  const styled = groups.flatMap(g => g.layers).filter(l => l.fillAttr && l.colorMap && l.visible)
  if (!styled.length) return null
  return (
    <div className="absolute bottom-3 left-3 z-[900] bg-white border border-slate-200 rounded-xl p-3 min-w-[160px] max-w-[200px] max-h-[220px] overflow-y-auto shadow-lg">
      {styled.map(l => {
        const cm = l.colorMap!
        return (
          <div key={l.id} className="mb-2 last:mb-0">
            <div className="text-[9px] font-bold text-slate-500 mb-1 uppercase tracking-wider">{l.name.slice(0, 20)}: {cm.field}</div>
            {cm.mode === 'categorical' ? Object.entries(cm.map).slice(0, 8).map(([val, color]) => (
              <div key={val} className="flex items-center gap-1.5 py-0.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ background: String(color) }} /><span className="text-[10px] text-slate-600 truncate">{val}</span></div>
            )) : <><div className="h-2 rounded my-1" style={{ background: `linear-gradient(90deg, ${cm.c1}, ${cm.c2})` }} /><div className="flex justify-between text-[9px] text-slate-400 font-mono"><span>{cm.min.toFixed(1)}</span><span>{cm.max.toFixed(1)}</span></div></>}
          </div>
        )
      })}
    </div>
  )
}

/* ── FILTERS PANE ── */
function FiltersPane({
  vendorRows, noVendor, owners, noOwner,
  hiddenVendors, hiddenOwners,
  colorMode, setColorMode,
  toggleVendor, toggleOwner, showOnlyVendor, showOnlyOwner,
  clearVendorFilter, clearOwnerFilter,
  vendorColorMap, ownerColorMap,
}: {
  vendorRows: { id: string; name: string; count: number }[]
  noVendor: number
  owners: [string, number][]
  noOwner: number
  hiddenVendors: Set<string>
  hiddenOwners: Set<string>
  colorMode: 'layer' | 'vendor' | 'owner'
  setColorMode: (m: 'layer' | 'vendor' | 'owner') => void
  toggleVendor: (id: string) => void
  toggleOwner: (name: string) => void
  showOnlyVendor: (id: string) => void
  showOnlyOwner: (name: string) => void
  clearVendorFilter: () => void
  clearOwnerFilter: () => void
  vendorColorMap: Record<string, string>
  ownerColorMap: Record<string, string>
}) {
  const [vq, setVq] = useState('')
  const [oq, setOq] = useState('')
  const totalFeats = vendorRows.reduce((s, v) => s + v.count, 0) + noVendor
  const filteredVendors = vendorRows.filter(v => v.name.toLowerCase().includes(vq.toLowerCase()))
  const filteredOwners = owners.filter(([o]) => o.toLowerCase().includes(oq.toLowerCase()))

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Color mode */}
      <div className="px-3 py-3 border-b border-slate-100">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Color Features By</div>
        <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 rounded-lg">
          {(['layer', 'vendor', 'owner'] as const).map(m => (
            <button key={m} onClick={() => setColorMode(m)} className={`py-1.5 text-[11px] font-semibold rounded-md transition-all capitalize ${colorMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Vendor filter */}
      <div className="px-3 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Vendor</span>
            <span className="text-[10px] font-mono text-slate-400">{vendorRows.length}</span>
          </div>
          {hiddenVendors.size > 0 && <button onClick={clearVendorFilter} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">Clear</button>}
        </div>
        <input value={vq} onChange={e => setVq(e.target.value)} placeholder="Filter vendors…" className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] outline-none focus:border-blue-300 focus:bg-white mb-1.5" />
        <div className="max-h-60 overflow-y-auto -mx-1 px-1">
          {filteredVendors.length === 0 && noVendor === 0 && <div className="text-[11px] text-slate-400 py-3 text-center">No vendor data on any feature yet</div>}
          {filteredVendors.map(v => {
            const hidden = hiddenVendors.has(v.id)
            return (
              <div key={v.id} className={`group flex items-center gap-2 py-1 px-1.5 rounded-md hover:bg-slate-50 transition-colors ${hidden ? 'opacity-40' : ''}`}>
                <button onClick={() => toggleVendor(v.id)} className="shrink-0">
                  <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center transition-all ${hidden ? 'border-slate-300 bg-white' : 'border-transparent'}`} style={{ background: hidden ? undefined : vendorColorMap[v.id] || '#94a3b8' }}>
                    {!hidden && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="3.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                  </div>
                </button>
                <span className="flex-1 text-[11px] text-slate-700 truncate font-medium">{v.name}</span>
                <span className="text-[10px] font-mono text-slate-400">{v.count}</span>
                <button onClick={() => showOnlyVendor(v.id)} className="opacity-0 group-hover:opacity-100 text-[9px] font-semibold text-blue-600 hover:text-blue-800 transition-opacity uppercase">Only</button>
              </div>
            )
          })}
          {noVendor > 0 && vq === '' && (
            <div className={`group flex items-center gap-2 py-1 px-1.5 rounded-md hover:bg-slate-50 ${hiddenVendors.has('__none__') ? 'opacity-40' : ''}`}>
              <button onClick={() => toggleVendor('__none__')} className="shrink-0">
                <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center ${hiddenVendors.has('__none__') ? 'border-slate-300 bg-white' : 'border-transparent bg-slate-400'}`}>
                  {!hiddenVendors.has('__none__') && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="3.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                </div>
              </button>
              <span className="flex-1 text-[11px] text-slate-500 italic">Unassigned</span>
              <span className="text-[10px] font-mono text-slate-400">{noVendor}</span>
            </div>
          )}
        </div>
      </div>

      {/* Owner filter */}
      <div className="px-3 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a8.25 8.25 0 0115 0" /></svg>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Owner</span>
            <span className="text-[10px] font-mono text-slate-400">{owners.length}</span>
          </div>
          {hiddenOwners.size > 0 && <button onClick={clearOwnerFilter} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">Clear</button>}
        </div>
        <input value={oq} onChange={e => setOq(e.target.value)} placeholder="Filter owners…" className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] outline-none focus:border-blue-300 focus:bg-white mb-1.5" />
        <div className="max-h-80 overflow-y-auto -mx-1 px-1">
          {filteredOwners.length === 0 && noOwner === 0 && <div className="text-[11px] text-slate-400 py-3 text-center">No owner attribute detected.<br />Owner keys like <code className="text-[10px] bg-slate-100 px-1 rounded">owner</code>, <code className="text-[10px] bg-slate-100 px-1 rounded">maintained_by</code>, <code className="text-[10px] bg-slate-100 px-1 rounded">operator</code>, <code className="text-[10px] bg-slate-100 px-1 rounded">carrier</code> are auto-detected.</div>}
          {filteredOwners.map(([name, count]) => {
            const hidden = hiddenOwners.has(name)
            return (
              <div key={name} className={`group flex items-center gap-2 py-1 px-1.5 rounded-md hover:bg-slate-50 transition-colors ${hidden ? 'opacity-40' : ''}`}>
                <button onClick={() => toggleOwner(name)} className="shrink-0">
                  <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center transition-all ${hidden ? 'border-slate-300 bg-white' : 'border-transparent'}`} style={{ background: hidden ? undefined : ownerColorMap[name] || '#94a3b8' }}>
                    {!hidden && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="3.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                  </div>
                </button>
                <span className="flex-1 text-[11px] text-slate-700 truncate font-medium" title={name}>{name}</span>
                <span className="text-[10px] font-mono text-slate-400">{count}</span>
                <button onClick={() => showOnlyOwner(name)} className="opacity-0 group-hover:opacity-100 text-[9px] font-semibold text-blue-600 hover:text-blue-800 transition-opacity uppercase">Only</button>
              </div>
            )
          })}
          {noOwner > 0 && oq === '' && (
            <div className={`group flex items-center gap-2 py-1 px-1.5 rounded-md hover:bg-slate-50 ${hiddenOwners.has('__none__') ? 'opacity-40' : ''}`}>
              <button onClick={() => toggleOwner('__none__')} className="shrink-0">
                <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center ${hiddenOwners.has('__none__') ? 'border-slate-300 bg-white' : 'border-transparent bg-slate-400'}`}>
                  {!hiddenOwners.has('__none__') && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="3.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                </div>
              </button>
              <span className="flex-1 text-[11px] text-slate-500 italic">Unattributed</span>
              <span className="text-[10px] font-mono text-slate-400">{noOwner}</span>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 py-3 text-[10px] text-slate-400 leading-relaxed">
        {totalFeats.toLocaleString()} features indexed. Click a color swatch to toggle; hover a row and click <span className="font-semibold text-blue-600">Only</span> to isolate.
      </div>
    </div>
  )
}

/* ── CHARTS PANE ── */
function ChartsPane({ groups }: { groups: FileGroup[] }) {
  const totalLayers = groups.reduce((s, g) => s + g.layers.length, 0)
  const totalFeats = groups.reduce((s, g) => s + g.layers.reduce((ss, l) => ss + l.count, 0), 0)
  const geomCounts: Record<string, number> = {}; const typeCounts: Record<string, number> = {}
  let totalLengthKm = 0
  groups.forEach(g => g.layers.forEach(l => {
    const t = autoType(l.name); typeCounts[t] = (typeCounts[t] || 0) + 1
    l.geojson.features.forEach(f => {
      const gt = (f.geometry?.type || 'Unknown').replace('Multi', ''); geomCounts[gt] = (geomCounts[gt] || 0) + 1
      totalLengthKm += geomLengthKm(f.geometry)
    })
  }))
  const layerFeats = groups.flatMap(g => g.layers).sort((a, b) => b.count - a.count).slice(0, 10)
  const COLORS = ['#2563EB', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#6366f1', '#be185d', '#65a30d']

  if (!totalLayers) return <div className="flex-1 flex items-center justify-center p-6"><div className="text-center text-slate-400"><span className="text-3xl block mb-2 opacity-40">📊</span><div className="text-sm">Load data to see analytics</div></div></div>

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        {[{ l: 'Files', v: groups.length, c: '#2563EB' }, { l: 'Layers', v: totalLayers, c: '#059669' }, { l: 'Features', v: totalFeats.toLocaleString(), c: '#7c3aed' }, { l: 'Length (km)', v: totalLengthKm.toFixed(1), c: '#d97706' }].map(s => (
          <div key={s.l} className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm">
            <div className="text-xl font-bold font-mono" style={{ color: s.c }}>{s.v}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5 font-medium">{s.l}</div>
          </div>
        ))}
      </div>
      {/* Geometry donut */}
      <ChartCard title="Features by Geometry" icon="📐">
        <DonutData data={Object.entries(geomCounts).map(([k, v], i) => ({ label: k, value: v, color: COLORS[i % COLORS.length] }))} />
      </ChartCard>
      {/* Layer types */}
      <ChartCard title="Layers by Type" icon="🗂">
        <DonutData data={Object.entries(typeCounts).map(([k, v], i) => ({ label: LAYER_TYPES[k]?.label || k, value: v, color: LAYER_TYPES[k]?.color || COLORS[i % COLORS.length] }))} />
      </ChartCard>
      {/* Top layers bar */}
      <ChartCard title="Top Layers by Features" icon="📌">
        <div className="space-y-1.5 px-1">{layerFeats.map((l, i) => { const max = layerFeats[0]?.count || 1; return (
          <div key={l.id} className="flex items-center gap-2">
            <span className="w-20 text-[10px] text-slate-500 text-right truncate shrink-0">{l.name.slice(0, 16)}</span>
            <div className="flex-1 h-4 bg-slate-100 rounded-md overflow-hidden"><div className="h-full rounded-md transition-all duration-500" style={{ width: `${(l.count / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div>
            <span className="w-10 text-[10px] text-slate-400 font-mono">{l.count}</span>
          </div>
        ) })}</div>
      </ChartCard>
    </div>
  )
}
function ChartCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"><div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2"><span className="text-sm">{icon}</span><span className="text-xs font-semibold text-slate-700">{title}</span></div><div className="p-2">{children}</div></div>
}
function DonutData({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0); if (!total) return null
  const R = 50, T = 16, cx = 65, cy = 60; let sa = -Math.PI / 2
  return (
    <div className="flex gap-3 items-start">
      <svg width={cx * 2} height={cy * 2 - 10} viewBox={`0 0 ${cx * 2} ${cy * 2 - 10}`} className="shrink-0">
        <circle cx={cx} cy={cy - 5} r={R} fill="none" stroke="#f1f5f9" strokeWidth={T} />
        {data.map((d, i) => { const angle = (d.value / total) * Math.PI * 2; const ea = sa + angle; const x1 = cx + R * Math.cos(sa), y1 = cy - 5 + R * Math.sin(sa), x2 = cx + R * Math.cos(ea), y2 = cy - 5 + R * Math.sin(ea); const ir1x = cx + (R - T) * Math.cos(sa), ir1y = cy - 5 + (R - T) * Math.sin(sa), ir2x = cx + (R - T) * Math.cos(ea), ir2y = cy - 5 + (R - T) * Math.sin(ea); const large = angle > Math.PI ? 1 : 0; const pathD = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ir2x} ${ir2y} A ${R - T} ${R - T} 0 ${large} 0 ${ir1x} ${ir1y} Z`; sa = ea; return <path key={i} d={pathD} fill={d.color} opacity={0.85} /> })}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="16" fontWeight="700" fill="#1e293b" fontFamily="var(--font-mono)">{total}</text>
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="9" fill="#94a3b8">TOTAL</text>
      </svg>
      <div className="flex-1 space-y-1 overflow-y-auto max-h-[120px]">{data.map(d => (
        <div key={d.label} className="flex items-center gap-1.5 text-[10px] text-slate-600"><div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} /><span className="truncate flex-1">{d.label}</span><span className="text-slate-400 font-mono">{d.value}</span><span className="text-blue-500 font-mono w-8 text-right">{((d.value / total) * 100).toFixed(0)}%</span></div>
      ))}</div>
    </div>
  )
}
