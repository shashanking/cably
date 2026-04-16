'use client'

import { useEffect, useRef, useState } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f1f5f9' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#cbd5e1' }] },
]

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

function isWashedOut(hex: string): boolean {
  if (!hex || hex.length < 7) return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return r > 200 && g > 200 && b > 200
}

type Removable = { map?: any } | { setMap: (m: any) => void }
function removeOverlay(o: Removable) {
  if ('setMap' in o && typeof o.setMap === 'function') o.setMap(null)
  else if ('map' in o) (o as any).map = null
}

function makeCirclePin(color: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 0 6px ${color}88, 0 2px 4px rgba(0,0,0,.3);cursor:pointer;`
  return el
}

function featureInfoHtml(feature: GeoJSON.Feature, color: string, layerName: string): string {
  const p = feature.properties as any || {}
  const name = p.name || p.Name || 'Unnamed'
  const entries = Object.entries(p)
    .filter(([k, v]) => !k.startsWith('_') && k !== 'styleUrl' && v != null && v !== '' && typeof v !== 'object')
    .slice(0, 6)
  return `<div style="font-family:system-ui;font-size:12px;max-width:280px">
    <div style="font-weight:700;margin-bottom:4px;color:#0f172a;display:flex;align-items:center;gap:6px">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
      ${name}
    </div>
    <div style="font-size:10px;color:#94a3b8;margin-bottom:6px;padding:2px 6px;background:#f1f5f9;border-radius:4px;display:inline-block">${layerName}</div>
    ${entries.map(([k, v]) => `<div style="display:flex;gap:6px;padding:2px 0;border-bottom:1px solid #f1f5f9;font-size:11px">
      <span style="color:#94a3b8;width:70px;flex-shrink:0;text-transform:uppercase;font-size:9px;padding-top:1px">${k}</span>
      <span style="color:#475569;word-break:break-all">${String(v).slice(0, 100)}</span>
    </div>`).join('')}
  </div>`
}

function zoomMapToFeature(map: google.maps.Map, feature: GeoJSON.Feature) {
  const geom = feature.geometry
  if (!geom) return
  if (geom.type === 'Point') {
    const c = (geom as GeoJSON.Point).coordinates
    if (c.length >= 2) { map.panTo({ lat: c[1], lng: c[0] }); map.setZoom(Math.max(map.getZoom() || 4, 15)) }
  } else {
    const bounds = new google.maps.LatLngBounds()
    const walk = (g: any) => {
      if (!g) return
      if (g.type === 'GeometryCollection') return g.geometries?.forEach(walk)
      const flatten = (c: any): number[][] => { if (!Array.isArray(c)) return []; if (typeof c[0] === 'number') return [c]; return c.flatMap(flatten) }
      if (g.coordinates) flatten(g.coordinates).forEach((c: number[]) => { if (c.length >= 2) bounds.extend({ lat: c[1], lng: c[0] }) })
    }
    walk(geom)
    if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 })
  }
}

function MyMapComponent({
  layers,
  onFeatureClick,
  selectedFeature,
}: {
  layers: GeoLayer[]
  onFeatureClick?: (feature: GeoJSON.Feature, color: string, layerName: string) => void
  selectedFeature?: GeoJSON.Feature | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const overlaysRef = useRef<Removable[]>([])
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const highlightRef = useRef<google.maps.Polyline | google.maps.Polygon | null>(null)

  useEffect(() => {
    if (ref.current && !map) {
      const newMap = new google.maps.Map(ref.current, {
        center: { lat: 39.5, lng: -98.35 },
        zoom: 4,
        mapId: 'cably_map',
        styles: mapStyle,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: google.maps.ControlPosition.TOP_RIGHT,
          mapTypeIds: ['roadmap', 'satellite', 'terrain'],
        },
        fullscreenControl: true,
        scaleControl: true,
        backgroundColor: '#f1f5f9',
      })
      infoRef.current = new google.maps.InfoWindow()
      setMap(newMap)
    }
  }, [map])

  useEffect(() => {
    if (!map) return

    overlaysRef.current.forEach(removeOverlay)
    const newOverlays: Removable[] = []
    const bounds = new google.maps.LatLngBounds()
    let hasFeatures = false
    const info = infoRef.current!

    const AdvMarker = google.maps.marker?.AdvancedMarkerElement

    for (const layer of layers) {
      if (!layer.visible) continue

      for (const feature of layer.geojson.features) {
        const geom = feature.geometry
        if (!geom) continue
        const raw = (feature.properties as any)?._color as string | undefined
        const color = (raw && !isWashedOut(raw)) ? raw : layer.color
        const fName = (feature.properties as any)?.name || (feature.properties as any)?.Name || ''

        const showInfo = (pos: google.maps.LatLng | google.maps.LatLngLiteral) => {
          info.setContent(featureInfoHtml(feature, color, layer.name))
          info.setPosition(pos)
          info.open(map)
          onFeatureClick?.(feature, color, layer.name)
        }

        const drawPoint = (coord: number[]) => {
          if (coord.length < 2 || isNaN(coord[0]) || isNaN(coord[1])) return
          const pos = { lat: coord[1], lng: coord[0] }
          if (AdvMarker) {
            const pin = makeCirclePin(color)
            pin.title = fName || layer.name
            const marker = new AdvMarker({ position: pos, map, title: fName || layer.name, content: pin })
            marker.addListener('click', () => showInfo(pos))
            newOverlays.push(marker)
          } else {
            const marker = new google.maps.Marker({
              position: pos, map, title: fName || layer.name,
              icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: color, fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: 2 },
            })
            marker.addListener('click', () => showInfo(pos))
            newOverlays.push(marker)
          }
          bounds.extend(pos); hasFeatures = true
        }

        const drawLine = (coords: number[][]) => {
          const path = coords.filter(c => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1])).map(c => ({ lat: c[1], lng: c[0] }))
          if (path.length < 2) return
          const shadow = new google.maps.Polyline({ path, strokeColor: '#000000', strokeOpacity: 0.08, strokeWeight: 6, map })
          newOverlays.push(shadow)
          const polyline = new google.maps.Polyline({ path, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 3, map })
          polyline.addListener('click', (e: any) => showInfo(e.latLng))
          // Hover: thicken line
          polyline.addListener('mouseover', () => { polyline.setOptions({ strokeWeight: 5, strokeOpacity: 1 }) })
          polyline.addListener('mouseout', () => { polyline.setOptions({ strokeWeight: 3, strokeOpacity: 0.9 }) })
          newOverlays.push(polyline)
          path.forEach(c => bounds.extend(c)); hasFeatures = true
        }

        const drawPolygon = (rings: number[][][]) => {
          const paths = rings.map(ring => ring.filter(c => c.length >= 2).map(c => ({ lat: c[1], lng: c[0] })))
          if (!paths[0]?.length) return
          const polygon = new google.maps.Polygon({ paths, strokeColor: color, strokeOpacity: 0.8, strokeWeight: 2, fillColor: color, fillOpacity: 0.2, map })
          polygon.addListener('click', (e: any) => showInfo(e.latLng))
          newOverlays.push(polygon)
          paths.flat().forEach(c => bounds.extend(c)); hasFeatures = true
        }

        const drawGeometry = (g: any) => {
          if (!g) return
          if (g.type === 'Point') drawPoint(g.coordinates)
          else if (g.type === 'MultiPoint') g.coordinates?.forEach(drawPoint)
          else if (g.type === 'LineString') drawLine(g.coordinates)
          else if (g.type === 'MultiLineString') g.coordinates?.forEach(drawLine)
          else if (g.type === 'Polygon') drawPolygon(g.coordinates)
          else if (g.type === 'MultiPolygon') g.coordinates?.forEach(drawPolygon)
          else if (g.type === 'GeometryCollection') g.geometries?.forEach(drawGeometry)
        }

        drawGeometry(geom)
      }
    }

    overlaysRef.current = newOverlays
    if (hasFeatures && !bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 })
    }
  }, [map, layers, onFeatureClick])

  // Zoom to selected feature from attribute table
  useEffect(() => {
    if (!map || !selectedFeature) return
    zoomMapToFeature(map, selectedFeature)
    // Highlight the feature briefly
    if (highlightRef.current) { removeOverlay(highlightRef.current); highlightRef.current = null }
    const geom = selectedFeature.geometry
    if (!geom) return
    const walk = (g: any): { lat: number; lng: number }[][] => {
      if (!g) return []
      if (g.type === 'Point') return [[{ lat: g.coordinates[1], lng: g.coordinates[0] }]]
      if (g.type === 'LineString') return [g.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] }))]
      if (g.type === 'MultiLineString') return g.coordinates.map((l: number[][]) => l.map((c: number[]) => ({ lat: c[1], lng: c[0] })))
      if (g.type === 'Polygon') return g.coordinates.map((r: number[][]) => r.map((c: number[]) => ({ lat: c[1], lng: c[0] })))
      if (g.type === 'GeometryCollection') return g.geometries.flatMap(walk)
      return []
    }
    const paths = walk(geom)
    if (geom.type === 'Point') {
      // For points, draw a pulsing circle around it
      const c = (geom as GeoJSON.Point).coordinates
      const circle = new google.maps.Circle({ center: { lat: c[1], lng: c[0] }, radius: 200, strokeColor: '#2563eb', strokeWeight: 3, strokeOpacity: 0.8, fillColor: '#2563eb', fillOpacity: 0.15, map })
      highlightRef.current = circle as any
      setTimeout(() => { if (highlightRef.current === circle as any) { circle.setMap(null); highlightRef.current = null } }, 4000)
    } else if (paths.length > 0 && paths[0].length > 1) {
      const hl = new google.maps.Polyline({ path: paths[0], strokeColor: '#f59e0b', strokeWeight: 6, strokeOpacity: 0.9, map, zIndex: 999 })
      highlightRef.current = hl
      setTimeout(() => { if (highlightRef.current === hl) { hl.setMap(null); highlightRef.current = null } }, 4000)
    }
  }, [map, selectedFeature])

  return <div ref={ref} style={{ height: '100%', width: '100%' }} />
}

export default function MapComponent({
  layers,
  onFeatureClick,
  selectedFeature,
}: {
  layers: GeoLayer[]
  onFeatureClick?: (feature: GeoJSON.Feature, color: string, layerName: string) => void
  selectedFeature?: GeoJSON.Feature | null
}) {
  const render = (status: Status) => {
    if (status === Status.LOADING) return <div className="flex h-full w-full items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-2"><svg className="h-6 w-6 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg><p className="text-xs text-slate-400">Loading map...</p></div></div>
    if (status === Status.FAILURE) return <div className="flex h-full w-full items-center justify-center bg-slate-50"><p className="text-xs text-red-500">Failed to load map</p></div>
    return <MyMapComponent layers={layers} onFeatureClick={onFeatureClick} selectedFeature={selectedFeature} />
  }

  return <Wrapper apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!} libraries={['marker']} render={render} />
}
