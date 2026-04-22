'use client'

import { useEffect, useRef, useState } from 'react'
import { getOwnerValue } from '../lib/styling'

// ── ArcGIS via CDN Dojo loader ─────────────────────────────────────────────
// The SDK is loaded as a <script> tag in app/layout.tsx rather than bundled,
// which keeps Next/Turbopack builds fast and memory-bounded. window.require()
// is the AMD loader the SDK exposes; we wrap it in a Promise-returning helper.
declare global {
  interface Window { require?: (modules: string[], cb: (...m: any[]) => void, err?: (e: Error) => void) => void }
}

async function amdRequire<T = any>(modulePath: string): Promise<{ default: T }> {
  return new Promise((resolve, reject) => {
    const attempt = (retriesLeft: number) => {
      if (typeof window === 'undefined') { reject(new Error('SSR')); return }
      if (!window.require) {
        if (retriesLeft <= 0) { reject(new Error('ArcGIS CDN script did not load')); return }
        setTimeout(() => attempt(retriesLeft - 1), 100)
        return
      }
      window.require([modulePath], (mod: T) => resolve({ default: mod }), (e: Error) => reject(e))
    }
    attempt(80) // up to ~8 seconds
  })
}

export interface GeoLayer {
  id: string
  name: string
  color: string
  visible: boolean
  geojson: GeoJSON.FeatureCollection
  geomType: string
  count: number
  fillAttr?: string | null
  colorMap?: any
}

export interface MapFilter {
  hiddenVendors?: Set<string>
  hiddenOwners?: Set<string>
  hiddenGroups?: Set<string>
  hiddenFacilities?: Set<string>
  vendorColorMap?: Record<string, string>
  ownerColorMap?: Record<string, string>
  colorMode?: 'layer' | 'vendor' | 'owner'
}

export interface RenderProgress {
  featuresPlotted: number
  featuresTotal: number
}

type OverlayItem = { id: string; title: string; type: string }

function isWashedOut(hex: string): boolean {
  if (!hex || hex.length < 7) return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return r > 200 && g > 200 && b > 200
}

function vendorIdOf(feature: GeoJSON.Feature): string | null {
  const p: any = feature.properties || {}
  const id = p.vendor_id ?? p.vendorId ?? p.__vendor_id
  if (id == null || id === '') return null
  return String(id)
}

function hexToRgba(hex: string, alpha: number): number[] {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  return [r, g, b, alpha]
}

// Extract an AGOL item ID (32 hex chars) from either a raw ID or a full URL.
function extractItemId(input: string): string {
  const trimmed = input.trim()
  const m = trimmed.match(/[a-f0-9]{32}/i)
  return m ? m[0] : trimmed
}

function popupContentHtml(feature: GeoJSON.Feature, color: string, layerName: string): string {
  const p = feature.properties as any || {}
  const entries = Object.entries(p)
    .filter(([k, v]) => !k.startsWith('_') && k !== 'styleUrl' && v != null && v !== '' && typeof v !== 'object')
    .slice(0, 8)
  return `<div style="font-family:system-ui;font-size:12px;max-width:280px">
    <div style="font-size:10px;color:#94a3b8;margin-bottom:6px;padding:2px 6px;background:#f1f5f9;border-radius:4px;display:inline-block">${layerName}</div>
    ${entries.map(([k, v]) => `<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid #f1f5f9;font-size:11px">
      <span style="color:#94a3b8;width:84px;flex-shrink:0;text-transform:uppercase;font-size:9px;padding-top:1px">${k}</span>
      <span style="color:#475569;word-break:break-all">${String(v).slice(0, 120)}</span>
    </div>`).join('')}
  </div>`
}

function explodeGeom(g: any): { esriGeom: any; kind: 'point' | 'line' | 'polygon' }[] {
  if (!g || !g.type) return []
  const out: { esriGeom: any; kind: 'point' | 'line' | 'polygon' }[] = []
  const sr = { wkid: 4326 }
  const pushPoint = (c: any) => {
    if (!Array.isArray(c) || c.length < 2) return
    const x = Number(c[0]), y = Number(c[1])
    if (isNaN(x) || isNaN(y)) return
    out.push({ kind: 'point', esriGeom: { type: 'point', longitude: x, latitude: y, spatialReference: sr } })
  }
  const pushLine = (coords: any[]) => {
    if (!Array.isArray(coords)) return
    const path = coords.filter(c => Array.isArray(c) && c.length >= 2 && !isNaN(Number(c[0])) && !isNaN(Number(c[1])))
      .map(c => [Number(c[0]), Number(c[1])])
    if (path.length < 2) return
    out.push({ kind: 'line', esriGeom: { type: 'polyline', paths: [path], spatialReference: sr } })
  }
  const pushPoly = (rings: any[]) => {
    if (!Array.isArray(rings)) return
    const r = rings.map((ring: any[]) => (Array.isArray(ring) ? ring : [])
      .filter((c: any) => Array.isArray(c) && c.length >= 2)
      .map((c: any) => [Number(c[0]), Number(c[1])]))
      .filter((ring: number[][]) => ring.length >= 3)
    if (!r.length) return
    out.push({ kind: 'polygon', esriGeom: { type: 'polygon', rings: r, spatialReference: sr } })
  }
  const walk = (gg: any) => {
    if (!gg || !gg.type) return
    const c = gg.coordinates
    if (gg.type === 'Point' && c) pushPoint(c)
    else if (gg.type === 'MultiPoint' && Array.isArray(c)) c.forEach(pushPoint)
    else if (gg.type === 'LineString' && Array.isArray(c)) pushLine(c)
    else if (gg.type === 'MultiLineString' && Array.isArray(c)) c.forEach(pushLine)
    else if (gg.type === 'Polygon' && Array.isArray(c)) pushPoly(c)
    else if (gg.type === 'MultiPolygon' && Array.isArray(c)) c.forEach(pushPoly)
    else if (gg.type === 'GeometryCollection' && Array.isArray(gg.geometries)) gg.geometries.forEach(walk)
  }
  walk(g)
  return out
}

export default function ArcGISMap({
  layers,
  onFeatureClick,
  selectedFeature,
  filter,
  onRenderProgress,
  compact,
}: {
  layers: GeoLayer[]
  onFeatureClick?: (feature: GeoJSON.Feature, color: string, layerName: string) => void
  selectedFeature?: GeoJSON.Feature | null
  filter?: MapFilter
  onRenderProgress?: (p: RenderProgress) => void
  /** Hide the AGOL + basemap controls for use as a thumbnail / embedded preview */
  compact?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const featureLayerRef = useRef<any>(null)
  const highlightLayerRef = useRef<any>(null)
  const graphicIndexRef = useRef<Map<any, { feature: GeoJSON.Feature; color: string; layerName: string }>>(new Map())
  const hasAutoFittedRef = useRef(false)
  const renderCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false })
  const readyRef = useRef(false)
  const tokenRef = useRef<string>('')
  const portalUrlRef = useRef<string>('https://www.arcgis.com')
  const overlayInstancesRef = useRef<Map<string, any>>(new Map())

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statusMsg, setStatusMsg] = useState('Loading ArcGIS SDK…')
  const [basemap, setBasemap] = useState<string>('osm')

  // AGOL content state
  const [webmapItemId, setWebmapItemId] = useState<string | null>(null)
  const [overlayItems, setOverlayItems] = useState<OverlayItem[]>([])
  const [agolOpen, setAgolOpen] = useState(false)
  const [agolInput, setAgolInput] = useState('')
  const [agolLoading, setAgolLoading] = useState(false)
  const [agolError, setAgolError] = useState<string | null>(null)

  const onFeatureClickRef = useRef(onFeatureClick)
  const onRenderProgressRef = useRef(onRenderProgress)
  useEffect(() => { onFeatureClickRef.current = onFeatureClick }, [onFeatureClick])
  useEffect(() => { onRenderProgressRef.current = onRenderProgress }, [onRenderProgress])

  // One-time SDK init
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setStatusMsg('Requesting ArcGIS token…')
        const tokenRes = await fetch('/api/arcgis/token', { cache: 'no-store' })
        if (!tokenRes.ok) throw new Error(`Token endpoint returned ${tokenRes.status}`)
        const { token, portalUrl, expiresAt } = await tokenRes.json()
        if (cancelled) return
        tokenRef.current = token
        portalUrlRef.current = portalUrl || 'https://www.arcgis.com'

        setStatusMsg('Loading map…')
        const [
          { default: esriConfig },
          { default: EsriMap },
          { default: MapView },
          { default: GraphicsLayer },
          { default: esriId },
        ] = await Promise.all([
          amdRequire<any>('esri/config'),
          amdRequire<any>('esri/Map'),
          amdRequire<any>('esri/views/MapView'),
          amdRequire<any>('esri/layers/GraphicsLayer'),
          amdRequire<any>('esri/identity/IdentityManager'),
        ])
        if (cancelled) return

        if (portalUrl) esriConfig.portalUrl = portalUrl

        const expires = typeof expiresAt === 'number' ? expiresAt : Date.now() + 30 * 60 * 1000
        const tokenServers = [
          'https://www.arcgis.com/sharing/rest',
          portalUrl ? `${portalUrl.replace(/\/$/, '')}/sharing/rest` : null,
          'https://ibasemaps-api.arcgis.com',
          'https://basemaps.arcgis.com',
          'https://basemapstyles-api.arcgis.com',
        ].filter(Boolean) as string[]
        for (const server of tokenServers) {
          esriId.registerToken({ server, token, expires })
        }

        if (!containerRef.current) return
        const featureLayer = new GraphicsLayer({ title: 'Cably Assets' })
        const highlightLayer = new GraphicsLayer({ title: '__highlight', listMode: 'hide' })
        featureLayerRef.current = featureLayer
        highlightLayerRef.current = highlightLayer

        const map = new EsriMap({ basemap, layers: [featureLayer, highlightLayer] })
        const view = new MapView({
          container: containerRef.current,
          map,
          center: [-98.35, 39.5],
          zoom: 4,
        })
        viewRef.current = view

        await view.when()
        if (cancelled) { view.destroy(); return }

        view.on('click', async (evt: any) => {
          // Always close any existing popup first. ArcGIS v5's openPopup
          // silently no-ops when a popup is already open, so subsequent
          // feature clicks would appear to do nothing without this.
          try { view.closePopup() } catch {}
          const hit = await view.hitTest(evt, { include: [featureLayer] })
          const graphicHit = hit.results.find((r: any) => r.type === 'graphic' && r.graphic)
          const g = graphicHit ? (graphicHit as any).graphic : null
          if (!g) return
          const info = graphicIndexRef.current.get(g)
          if (!info) return
          if (onFeatureClickRef.current) {
            // Parent owns the UI — ensure native popup stays closed.
            onFeatureClickRef.current(info.feature, info.color, info.layerName)
          } else {
            // Give the popup a tick to fully unmount before re-opening
            setTimeout(() => {
              view.openPopup({
                title: (info.feature.properties as any)?.name || (info.feature.properties as any)?.Name || 'Feature',
                content: popupContentHtml(info.feature, info.color, info.layerName),
                location: evt.mapPoint,
              })
            }, 0)
          }
        })

        readyRef.current = true
        setStatus('ready')
      } catch (err: any) {
        console.error('[ArcGISMap] init failed', err)
        setStatus('error')
        setStatusMsg(err?.message || 'Failed to load ArcGIS map')
      }
    })()

    return () => {
      cancelled = true
      if (viewRef.current) {
        try { viewRef.current.destroy() } catch {}
        viewRef.current = null
      }
      readyRef.current = false
    }
  }, [])

  // Basemap switcher — only applies when no WebMap is active (WebMap brings its own basemap)
  useEffect(() => {
    const view = viewRef.current
    if (!view || status !== 'ready') return
    if (webmapItemId) return
    try { view.map.basemap = basemap as any } catch {}
  }, [basemap, webmapItemId, status])

  // WebMap swap: when an AGOL Web Map ID is set, replace view.map with that WebMap.
  // Cably's feature + highlight layers and any overlay feature layers are re-attached on top.
  useEffect(() => {
    if (status !== 'ready') return
    const view = viewRef.current
    if (!view) return

    let cancelled = false
    ;(async () => {
      try {
        if (webmapItemId) {
          const { default: WebMap } = await amdRequire<any>('esri/WebMap')
          const wm = new WebMap({ portalItem: { id: webmapItemId } })
          await wm.loadAll()
          if (cancelled) return
          view.map = wm
          if (featureLayerRef.current) wm.add(featureLayerRef.current)
          if (highlightLayerRef.current) wm.add(highlightLayerRef.current)
          for (const layer of overlayInstancesRef.current.values()) wm.add(layer)
          // Zoom to the web map's initial extent
          try {
            const vp = (wm as any).initialViewProperties?.viewpoint
            if (vp) view.viewpoint = vp
          } catch {}
        } else {
          const { default: EsriMap } = await amdRequire<any>('esri/Map')
          const m = new EsriMap({ basemap })
          if (featureLayerRef.current) m.add(featureLayerRef.current)
          if (highlightLayerRef.current) m.add(highlightLayerRef.current)
          for (const layer of overlayInstancesRef.current.values()) m.add(layer)
          view.map = m
        }
      } catch (err: any) {
        console.error('[ArcGISMap] WebMap swap failed', err)
        setAgolError(`Failed to load Web Map: ${err.message || err}`)
        setWebmapItemId(null)
      }
    })()
    return () => { cancelled = true }
  }, [webmapItemId, status])

  // Overlay diff: add/remove FeatureLayers from AGOL items
  useEffect(() => {
    if (status !== 'ready') return
    const view = viewRef.current
    if (!view) return

    let cancelled = false
    ;(async () => {
      const { default: FeatureLayer } = await amdRequire<any>('esri/layers/FeatureLayer')
      if (cancelled) return

      const wanted = new Set(overlayItems.map(o => o.id))
      // Remove
      for (const [id, layer] of Array.from(overlayInstancesRef.current)) {
        if (!wanted.has(id)) {
          try { view.map.remove(layer) } catch {}
          overlayInstancesRef.current.delete(id)
        }
      }
      // Add
      for (const item of overlayItems) {
        if (overlayInstancesRef.current.has(item.id)) continue
        try {
          const layer = new FeatureLayer({ portalItem: { id: item.id } } as any)
          overlayInstancesRef.current.set(item.id, layer)
          // Insert just below the highlight layer so Cably selections stay on top
          const idx = highlightLayerRef.current ? view.map.layers.indexOf(highlightLayerRef.current) : -1
          if (idx >= 0) view.map.add(layer, idx)
          else view.map.add(layer)
        } catch (err) {
          console.error('[ArcGISMap] failed to add overlay', item.id, err)
        }
      }
    })()
    return () => { cancelled = true }
  }, [overlayItems, status])

  // Render Cably features whenever layers / filter change
  useEffect(() => {
    if (status !== 'ready') return
    const view = viewRef.current
    const featureLayer = featureLayerRef.current
    if (!view || !featureLayer) return

    renderCancelRef.current.cancelled = true
    const cancelToken = { cancelled: false }
    renderCancelRef.current = cancelToken

    ;(async () => {
      const { default: Graphic } = await amdRequire<any>('esri/Graphic')
      if (cancelToken.cancelled) return

      featureLayer.removeAll()
      graphicIndexRef.current = new Map()

      type Item = { feature: GeoJSON.Feature; color: string; layerName: string; geom: any; fName: string }
      const queue: Item[] = []
      const hiddenVendors = filter?.hiddenVendors
      const hiddenOwners = filter?.hiddenOwners
      const hiddenGroups = filter?.hiddenGroups
      const hiddenFacilities = filter?.hiddenFacilities
      const vendorColorMap = filter?.vendorColorMap
      const ownerColorMap = filter?.ownerColorMap
      const colorMode = filter?.colorMode || 'layer'

      for (const layer of layers) {
        if (!layer.visible) continue
        for (const feature of layer.geojson.features) {
          let geom: any = feature.geometry
          if (!geom) continue
          if (typeof geom === 'string') { try { geom = JSON.parse(geom) } catch { continue } }
          if (!geom || !geom.type) continue
          const vid = vendorIdOf(feature)
          if (hiddenVendors && hiddenVendors.size > 0 && hiddenVendors.has(vid ?? '__none__')) continue
          const owner = getOwnerValue(feature.properties) || null
          if (hiddenOwners && hiddenOwners.size > 0 && hiddenOwners.has(owner ?? '__none__')) continue
          const props = feature.properties as any
          const group = props?.Group || props?.group || null
          if (hiddenGroups && hiddenGroups.size > 0 && hiddenGroups.has(group ?? '__none__')) continue
          const facility = props?.Facility || props?.facility || null
          if (hiddenFacilities && hiddenFacilities.size > 0 && hiddenFacilities.has(facility ?? '__none__')) continue
          const raw = ((feature.properties as any)?._color || (feature.properties as any)?.__color) as string | undefined
          let color = (raw && !isWashedOut(raw)) ? raw : layer.color
          if (colorMode === 'vendor' && vendorColorMap) color = vendorColorMap[vid ?? '__none__'] || '#94a3b8'
          else if (colorMode === 'owner' && ownerColorMap) color = ownerColorMap[owner ?? '__none__'] || '#94a3b8'
          const fName = (feature.properties as any)?.name || (feature.properties as any)?.Name || ''
          queue.push({ feature, color, layerName: layer.name, geom, fName })
        }
      }

      const total = queue.length
      onRenderProgressRef.current?.({ featuresPlotted: 0, featuresTotal: total })

      const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
      const extend = (x: number, y: number) => {
        if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y
        if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y
      }

      const CHUNK = 400
      let plotted = 0
      for (let i = 0; i < queue.length; i += CHUNK) {
        if (cancelToken.cancelled) return
        const batch: any[] = []
        const slice = queue.slice(i, i + CHUNK)
        for (const it of slice) {
          for (const piece of explodeGeom(it.geom)) {
            let symbol: any
            if (piece.kind === 'point') {
              symbol = { type: 'simple-marker', style: 'circle', color: hexToRgba(it.color, 0.95), size: 9, outline: { color: [255, 255, 255, 1], width: 2 } }
              extend(piece.esriGeom.longitude, piece.esriGeom.latitude)
            } else if (piece.kind === 'line') {
              symbol = { type: 'simple-line', color: hexToRgba(it.color, 0.95), width: 2.5, cap: 'round', join: 'round' }
              for (const path of piece.esriGeom.paths) for (const c of path) extend(c[0], c[1])
            } else {
              symbol = { type: 'simple-fill', color: hexToRgba(it.color, 0.2), outline: { color: hexToRgba(it.color, 0.9), width: 1.5 } }
              for (const ring of piece.esriGeom.rings) for (const c of ring) extend(c[0], c[1])
            }
            const graphic = new Graphic({ geometry: piece.esriGeom, symbol })
            graphicIndexRef.current.set(graphic, { feature: it.feature, color: it.color, layerName: it.layerName })
            batch.push(graphic)
          }
        }
        featureLayer.addMany(batch)
        plotted += slice.length
        onRenderProgressRef.current?.({ featuresPlotted: plotted, featuresTotal: total })
        await new Promise(r => requestAnimationFrame(() => r(null)))
      }

      if (cancelToken.cancelled) return
      if (!hasAutoFittedRef.current && !webmapItemId && bbox[0] !== Infinity) {
        try {
          const { default: Extent } = await amdRequire<any>('esri/geometry/Extent')
          if (cancelToken.cancelled) return
          const extent = new Extent({ xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } })
          view.goTo(extent.expand(1.2)).catch(() => {})
          hasAutoFittedRef.current = true
        } catch {}
      }
    })()
  }, [layers, filter, status])

  // Highlight the selected feature
  useEffect(() => {
    if (status !== 'ready') return
    const highlightLayer = highlightLayerRef.current
    if (!highlightLayer) return
    ;(async () => {
      highlightLayer.removeAll()
      if (!selectedFeature?.geometry) return
      const { default: Graphic } = await amdRequire<any>('esri/Graphic')
      for (const piece of explodeGeom(selectedFeature.geometry)) {
        let symbol: any
        if (piece.kind === 'point') {
          symbol = { type: 'simple-marker', style: 'circle', color: [255, 255, 255, 0], size: 22, outline: { color: [37, 99, 235, 1], width: 3 } }
        } else if (piece.kind === 'line') {
          symbol = { type: 'simple-line', color: [37, 99, 235, 1], width: 6, cap: 'round', join: 'round' }
        } else {
          symbol = { type: 'simple-fill', color: [37, 99, 235, 0.15], outline: { color: [37, 99, 235, 1], width: 3 } }
        }
        highlightLayer.add(new Graphic({ geometry: piece.esriGeom, symbol }))
      }
    })()
  }, [selectedFeature, status])

  // Resolve an AGOL item ID by querying the portal, then load as WebMap or overlay.
  async function loadAgolItem() {
    const raw = agolInput.trim()
    if (!raw) return
    const id = extractItemId(raw)
    setAgolLoading(true)
    setAgolError(null)
    try {
      const portal = portalUrlRef.current.replace(/\/$/, '')
      const url = `${portal}/sharing/rest/content/items/${id}?f=json&token=${encodeURIComponent(tokenRef.current)}`
      const info = await fetch(url).then(r => r.json())
      if (info.error) throw new Error(info.error.message || 'Item not found')
      const title: string = info.title || id
      const type: string = info.type || 'Unknown'

      if (type === 'Web Map') {
        setWebmapItemId(id)
      } else if (type === 'Feature Service' || type === 'Feature Collection') {
        setOverlayItems(prev => prev.some(o => o.id === id) ? prev : [...prev, { id, title, type }])
      } else {
        throw new Error(`Unsupported item type: ${type}. Cably supports Web Map and Feature Service.`)
      }
      setAgolInput('')
    } catch (err: any) {
      setAgolError(err.message || 'Failed to load item')
    } finally {
      setAgolLoading(false)
    }
  }

  function removeOverlayItem(id: string) {
    setOverlayItems(prev => prev.filter(o => o.id !== id))
  }

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />

      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/90 z-10 pointer-events-none">
          <div className="flex items-center gap-3 bg-white rounded-xl px-5 py-3 shadow-lg border border-slate-200">
            {status === 'loading' ? (
              <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-red-500" />
            )}
            <span className="text-sm text-slate-600">{statusMsg}</span>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* Basemap switcher (top-right) */}
          {!compact && !webmapItemId && (
            <div className="absolute top-3 right-3 z-[5] bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-sm p-1 flex gap-1 text-[11px] font-medium">
              {[
                { k: 'osm', l: 'OSM' },
                { k: 'streets-vector', l: 'Streets' },
                { k: 'streets-navigation-vector', l: 'Nav' },
                { k: 'hybrid', l: 'Satellite' },
                { k: 'topo-vector', l: 'Topo' },
                { k: 'dark-gray-vector', l: 'Dark' },
              ].map(b => (
                <button
                  key={b.k}
                  onClick={() => setBasemap(b.k)}
                  className={`px-2.5 py-1 rounded ${basemap === b.k ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {b.l}
                </button>
              ))}
            </div>
          )}

          {/* AGOL toggle button (top-left) */}
          {!compact && (
          <button
            onClick={() => setAgolOpen(v => !v)}
            className={`absolute top-3 left-3 z-[6] px-3 py-1.5 rounded-lg shadow-sm border text-[11px] font-medium flex items-center gap-1.5 ${agolOpen ? 'bg-blue-600 text-white border-blue-700' : 'bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            ArcGIS Online
            {(webmapItemId || overlayItems.length > 0) && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-white/20 text-[10px]">
                {(webmapItemId ? 1 : 0) + overlayItems.length}
              </span>
            )}
          </button>
          )}

          {/* AGOL panel */}
          {!compact && agolOpen && (
            <div className="absolute top-[52px] left-3 z-[6] bg-white/98 backdrop-blur border border-slate-200 rounded-lg shadow-xl p-3 w-[340px] text-[11px] text-slate-700">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-slate-900 text-xs">Load from ArcGIS Online</div>
                <button onClick={() => setAgolOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm leading-none">✕</button>
              </div>

              {/* Current web map */}
              {webmapItemId && (
                <div className="mb-2 p-2 bg-blue-50 rounded border border-blue-100 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[9px] text-blue-500 uppercase tracking-wide">Active Web Map</div>
                    <div className="font-mono text-[10px] text-blue-900 truncate">{webmapItemId}</div>
                  </div>
                  <button onClick={() => setWebmapItemId(null)} className="text-[11px] text-blue-600 hover:text-blue-800 shrink-0">Remove</button>
                </div>
              )}

              {/* Overlay items */}
              {overlayItems.length > 0 && (
                <div className="mb-2 space-y-1">
                  <div className="text-[9px] uppercase tracking-wide text-slate-400">Overlays ({overlayItems.length})</div>
                  {overlayItems.map(o => (
                    <div key={o.id} className="flex items-center justify-between gap-2 p-1.5 bg-slate-50 rounded border border-slate-100">
                      <div className="min-w-0">
                        <div className="truncate text-slate-800 font-medium">{o.title}</div>
                        <div className="text-[9px] text-slate-400">{o.type}</div>
                      </div>
                      <button onClick={() => removeOverlayItem(o.id)} className="text-slate-400 hover:text-red-600 text-sm leading-none shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={agolInput}
                  onChange={e => setAgolInput(e.target.value)}
                  placeholder="Paste item ID or AGOL item URL"
                  className="w-full px-2 py-1.5 border border-slate-200 rounded text-[11px] font-mono focus:outline-none focus:border-blue-400"
                  onKeyDown={e => { if (e.key === 'Enter') loadAgolItem() }}
                  disabled={agolLoading}
                />
                <button
                  onClick={loadAgolItem}
                  disabled={agolLoading || !agolInput.trim()}
                  className="w-full px-2 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {agolLoading ? 'Loading…' : 'Load from ArcGIS Online'}
                </button>
                {agolError && <div className="text-red-600 text-[11px] leading-snug">{agolError}</div>}
              </div>

              {/* In-app docs */}
              <details className="mt-3 pt-3 border-t border-slate-100">
                <summary className="cursor-pointer text-slate-600 hover:text-slate-800 select-none font-medium">How to use this</summary>
                <div className="mt-2 space-y-2 font-normal leading-relaxed">
                  <div>
                    <b className="text-slate-900">1. Find the item in ArcGIS Online</b><br />
                    Open the item's page in your AGOL org. The URL looks like:<br />
                    <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px] break-all">…/home/item.html?id=<span className="text-blue-600">32‑char‑id</span></code><br />
                    Paste the full URL or just the ID above — Cably will extract it.
                  </div>
                  <div>
                    <b className="text-slate-900">2. Supported item types</b>
                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                      <li><b>Web Map</b> — replaces the basemap and loads every layer the author configured, including popups &amp; symbology. The basemap switcher hides while active.</li>
                      <li><b>Feature Service</b> — adds the hosted feature layer as an overlay on top of the current basemap and below Cably's own asset layer.</li>
                    </ul>
                  </div>
                  <div>
                    <b className="text-slate-900">3. Sharing</b><br />
                    The item must be shared with <em>Everyone</em>, <em>Your organization</em>, or specifically with the user that owns the OAuth app Cably uses. Private items owned by other users will fail with a 403.
                  </div>
                  <div>
                    <b className="text-slate-900">4. Cably data stays layered on top</b><br />
                    Loading AGOL content never removes your uploaded / DB-backed assets — they render as always, and clicks on them still open the attribute popup.
                  </div>
                  <div>
                    <b className="text-slate-900">5. Troubleshooting</b>
                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                      <li><em>403 / not authorized:</em> item sharing isn't set correctly, or your OAuth app isn't registered to the item's owner's org.</li>
                      <li><em>Unsupported item type:</em> Dashboards, Experience Builder apps and StoryMaps are full apps — embed those as <code className="bg-slate-100 px-1 rounded">iframe</code>s instead.</li>
                      <li><em>Empty map after load:</em> the web map's initial extent may be off-screen; use the Home button in the view controls.</li>
                    </ul>
                  </div>
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  )
}
