'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

export interface LayerData {
  id: string
  name: string
  color: string
  visible: boolean
  geojson: GeoJSON.FeatureCollection
  geomType: string
  count: number
  leafletLayer?: any
  fillAttr?: string | null
  colorMap?: ColorMap | null
}

export type ColorMap =
  | { mode: 'categorical'; field: string; map: Record<string, string>; counts: Record<string, number> }
  | { mode: 'graduated'; field: string; min: number; max: number; c1: string; c2: string }

const BASEMAPS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '\u00a9OpenStreetMap \u00a9CARTO',
  },
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '\u00a9OpenStreetMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Tiles\u00a9Esri',
  },
}

const CAT_COLORS = [
  '#2563EB','#F59E0B','#00E5A0','#FF6B6B','#9B7BFF',
  '#2ADFB8','#FFB340','#6B8EFF','#FF6B9D','#00C8FF','#7DDE86','#FFA07A',
]

function hexToRgb(h: string): [number, number, number] {
  const r = parseInt(h.slice(1, 3), 16)
  const g = parseInt(h.slice(3, 5), 16)
  const b = parseInt(h.slice(5, 7), 16)
  return [r, g, b]
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}
function interpolateColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

export function makeColorFn(cm: ColorMap): (f: GeoJSON.Feature) => string {
  if (cm.mode === 'categorical') {
    return (f) => {
      const v = String((f.properties as any)?.[cm.field] ?? '')
      return cm.map[v] || '#888888'
    }
  } else {
    return (f) => {
      const v = parseFloat((f.properties as any)?.[cm.field])
      if (isNaN(v)) return '#888888'
      const t = Math.max(0, Math.min(1, (v - cm.min) / (cm.max - cm.min || 1)))
      return interpolateColor(cm.c1, cm.c2, t)
    }
  }
}

export function buildColorMap(features: GeoJSON.Feature[], field: string, mode: 'categorical' | 'graduated', layerId: string): ColorMap | null {
  const SKIP = new Set([null, undefined, '', 'null', 'undefined'])
  const vals = features.map(f => (f.properties as any)?.[field]).filter((v: any) => !SKIP.has(v) && v !== null && v !== undefined)
  if (!vals.length) return null

  if (mode === 'categorical') {
    const unique = [...new Set(vals.map((v: any) => String(v)))].slice(0, CAT_COLORS.length)
    const counts: Record<string, number> = {}
    vals.forEach((v: any) => { const k = String(v); counts[k] = (counts[k] || 0) + 1 })
    return {
      mode: 'categorical',
      field,
      map: Object.fromEntries(unique.map((v, i) => [v, CAT_COLORS[i]])),
      counts,
    }
  } else {
    const nums = vals.map((v: any) => parseFloat(v)).filter((v: number) => !isNaN(v))
    if (!nums.length) return null
    const GRAD_RAMPS = [
      ['#E0F2FE', '#0369A1'], ['#DCFCE7', '#166534'], ['#FEF9C3', '#A16207'],
      ['#F3E8FF', '#7E22CE'], ['#FFE4E6', '#BE123C'], ['#FFF7ED', '#C2410C'],
    ]
    const idx = parseInt(layerId) % GRAD_RAMPS.length || 0
    return {
      mode: 'graduated',
      field,
      min: Math.min(...nums),
      max: Math.max(...nums),
      c1: GRAD_RAMPS[idx][0],
      c2: GRAD_RAMPS[idx][1],
    }
  }
}

interface Props {
  layers: LayerData[]
  onFeatureClick?: (feature: GeoJSON.Feature, color: string) => void
  onCoordsChange?: (lat: number, lng: number) => void
  onZoomChange?: (zoom: number) => void
  basemap?: 'dark' | 'streets' | 'satellite'
}

export default function LeafletMap({ layers, onFeatureClick, onCoordsChange, onZoomChange, basemap = 'dark' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const tileRef = useRef<any>(null)
  const layerGroupRef = useRef<Map<string, any>>(new Map())
  const LRef = useRef<any>(null)
  const [ready, setReady] = useState(false)

  // Load Leaflet dynamically
  useEffect(() => {
    let cancelled = false
    async function loadLeaflet() {
      if (typeof window === 'undefined') return
      const L = await import('leaflet')
      if (cancelled) return
      LRef.current = L.default || L
      setReady(true)
    }
    loadLeaflet()
    return () => { cancelled = true }
  }, [])

  // Initialize map
  useEffect(() => {
    const L = LRef.current
    if (!L || !containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [39.5, -98.35],
      zoom: 4,
      zoomControl: false,
      preferCanvas: true,
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      keyboard: true,
    })
    const bm = BASEMAPS[basemap]
    tileRef.current = L.tileLayer(bm.url, { attribution: bm.attr, maxZoom: 20 }).addTo(map)
    mapRef.current = map

    // Ensure map knows its size after mount
    setTimeout(() => map.invalidateSize(), 100)

    map.on('mousemove', (e: any) => onCoordsChange?.(e.latlng.lat, e.latlng.lng))
    map.on('zoomend', () => onZoomChange?.(map.getZoom()))

    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // Switch basemap
  useEffect(() => {
    if (!tileRef.current) return
    const bm = BASEMAPS[basemap]
    tileRef.current.setUrl(bm.url)
  }, [basemap])

  // Sync layers
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return

    const currentIds = new Set(layers.map(l => l.id))
    // Remove layers no longer present
    for (const [id, lg] of layerGroupRef.current) {
      if (!currentIds.has(id)) {
        map.removeLayer(lg)
        layerGroupRef.current.delete(id)
      }
    }

    let hasBounds = false
    const bounds = L.latLngBounds([])

    for (const layer of layers) {
      const existing = layerGroupRef.current.get(layer.id)

      if (!layer.visible) {
        if (existing) map.removeLayer(existing)
        continue
      }

      // Build color function
      let colorFn: ((f: GeoJSON.Feature) => string) | null = null
      if (layer.colorMap) {
        colorFn = makeColorFn(layer.colorMap)
      }

      const colorMapKey = JSON.stringify(layer.colorMap)
      if (!existing || (existing as any).__colorMapKey !== colorMapKey || (existing as any).__baseColor !== layer.color) {
        if (existing) map.removeLayer(existing)

        const geoLayer = L.geoJSON(layer.geojson, {
          style: (f: any) => {
            const c = colorFn ? colorFn(f!) : (f?.properties?._color || layer.color)
            return {
              color: c,
              weight: 2.5,
              opacity: 0.9,
              fillColor: c,
              fillOpacity: 0.25,
              lineCap: 'round' as const,
              lineJoin: 'round' as const,
            }
          },
          pointToLayer: (f: any, ll: any) => {
            const c = colorFn ? colorFn(f) : (f.properties?._color || layer.color)
            return L.circleMarker(ll, {
              radius: 6,
              fillColor: c,
              color: '#fff',
              weight: 1.5,
              fillOpacity: 0.9,
              opacity: 1,
            })
          },
          onEachFeature: (f: any, feat: any) => {
            feat.on('click', (e: any) => {
              L.DomEvent.stopPropagation(e)
              const c = colorFn ? colorFn(f) : (f.properties?._color || layer.color)
              onFeatureClick?.(f, c)
            })
            const n = f.properties?.name || f.properties?.Name
            if (n) feat.bindTooltip(n, { sticky: true, opacity: 0.95 })
          },
        })

        ;(geoLayer as any).__colorMapKey = colorMapKey
        ;(geoLayer as any).__baseColor = layer.color
        geoLayer.addTo(map)
        layerGroupRef.current.set(layer.id, geoLayer)
      } else if (existing && !map.hasLayer(existing)) {
        existing.addTo(map)
      }

      // Extend bounds
      const lg = layerGroupRef.current.get(layer.id)
      if (lg) {
        try {
          const b = lg.getBounds()
          if (b.isValid()) { bounds.extend(b); hasBounds = true }
        } catch {}
      }
    }

    if (hasBounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    }
  }, [layers, onFeatureClick, ready])

  const fitAll = useCallback(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    const bounds = L.latLngBounds([])
    for (const lg of layerGroupRef.current.values()) {
      try {
        const b = lg.getBounds()
        if (b.isValid()) bounds.extend(b)
      } catch {}
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] })
  }, [])

  const zoomIn = useCallback(() => mapRef.current?.zoomIn(), [])
  const zoomOut = useCallback(() => mapRef.current?.zoomOut(), [])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-[900] flex flex-col gap-1">
        <button onClick={zoomIn} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 cursor-pointer text-base font-bold flex items-center justify-center hover:border-blue-300 hover:text-blue-600 shadow-sm transition-all">+</button>
        <button onClick={zoomOut} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 cursor-pointer text-base font-bold flex items-center justify-center hover:border-blue-300 hover:text-blue-600 shadow-sm transition-all">&minus;</button>
        <button onClick={fitAll} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 cursor-pointer text-xs flex items-center justify-center hover:border-blue-300 hover:text-blue-600 shadow-sm transition-all">&oplus;</button>
      </div>
    </div>
  )
}
