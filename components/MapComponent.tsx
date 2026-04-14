'use client'

import { useEffect, useRef, useState } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { assetColor, assetWidth, FALLBACK, Stats, StyleMode } from '../lib/styling'

const lng = -73.97
const lat = 40.75
const zoom = 11

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

export interface Asset {
  id: number
  type: string
  geometry: any
  properties: any
}

export interface Dataset {
  id: number
  name: string
  feature_count: number
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null
  centroid: { lng: number; lat: number } | null
}

type Overlay = google.maps.Marker | google.maps.Polyline | google.maps.Polygon | google.maps.Rectangle

function MyMapComponent({
  assets,
  datasets,
  selectedAsset,
  onDatasetSelect,
  styleMode,
  stats,
}: {
  assets: Asset[]
  datasets: Dataset[]
  selectedAsset?: Asset
  onDatasetSelect?: (id: number) => void
  styleMode: StyleMode
  stats: Stats
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [overlays, setOverlays] = useState<Overlay[]>([])

  useEffect(() => {
    if (ref.current && !map) {
      const newMap = new google.maps.Map(ref.current, {
        center: { lat, lng },
        zoom,
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
      setMap(newMap)
    }
  }, [map])

  useEffect(() => {
    if (!map) return

    overlays.forEach(o => o.setMap(null))
    const newOverlays: Overlay[] = []

    // Collection view: one marker + bbox per dataset
    if (assets.length === 0 && datasets.length > 0) {
      const bounds = new google.maps.LatLngBounds()
      datasets.forEach(ds => {
        if (!ds.centroid || !ds.bbox) return
        const rect = new google.maps.Rectangle({
          bounds: {
            north: ds.bbox.maxLat,
            south: ds.bbox.minLat,
            east: ds.bbox.maxLng,
            west: ds.bbox.minLng,
          },
          strokeColor: '#2563eb',
          strokeOpacity: 0.6,
          strokeWeight: 1.5,
          fillColor: '#2563eb',
          fillOpacity: 0.08,
          map,
          clickable: true,
        })
        rect.addListener('click', () => onDatasetSelect?.(ds.id))
        newOverlays.push(rect)

        const marker = new google.maps.Marker({
          position: { lat: ds.centroid.lat, lng: ds.centroid.lng },
          map,
          title: `${ds.name} — ${ds.feature_count} features`,
          label: { text: String(ds.feature_count), color: '#ffffff', fontSize: '11px', fontWeight: '600' },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#2563eb',
            fillOpacity: 0.95,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        })
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:system-ui;font-size:12px;padding:2px 0">
            <div style="font-weight:600;margin-bottom:2px">${ds.name}</div>
            <div style="color:#64748b">${ds.feature_count} features</div>
          </div>`,
        })
        marker.addListener('click', () => info.open(map, marker))
        newOverlays.push(marker)

        bounds.extend({ lat: ds.bbox.minLat, lng: ds.bbox.minLng })
        bounds.extend({ lat: ds.bbox.maxLat, lng: ds.bbox.maxLng })
      })
      setOverlays(newOverlays)
      if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
      return
    }

    if (assets.length === 0) {
      setOverlays(newOverlays)
      return
    }

    const bounds = new google.maps.LatLngBounds()

    for (const asset of assets) {
      const color = assetColor(asset, styleMode, stats) || FALLBACK
      const width = assetWidth(asset, styleMode, stats)
      const geom = asset.geometry
      if (!geom) continue

      const drawPoint = (coord: number[]) => {
        const marker = new google.maps.Marker({
          position: { lat: coord[1], lng: coord[0] },
          map,
          title: asset.properties?.name || asset.properties?.Name || asset.type,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: color,
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 1.5,
          },
        })
        const label = asset.properties?.name || asset.properties?.Name || 'Unnamed'
        const sub =
          asset.properties?.Facility ||
          asset.properties?.Group ||
          asset.properties?.Physical_address ||
          asset.type
        const infoWindow = new google.maps.InfoWindow({
          content: `<div style="font-family:system-ui;font-size:12px;padding:2px 0">
            <div style="font-weight:600;margin-bottom:2px">${label}</div>
            <div style="color:#64748b">${sub}</div>
          </div>`,
        })
        marker.addListener('click', () => infoWindow.open(map, marker))
        newOverlays.push(marker)
        bounds.extend({ lat: coord[1], lng: coord[0] })
      }

      const drawLine = (path: { lat: number; lng: number }[]) => {
        const shadow = new google.maps.Polyline({
          path, strokeColor: '#000000', strokeOpacity: 0.1, strokeWeight: width + 3, map,
        })
        newOverlays.push(shadow)
        const polyline = new google.maps.Polyline({
          path, strokeColor: color, strokeOpacity: 0.85, strokeWeight: width, map,
        })
        const info = new google.maps.InfoWindow({
          content: `<div style="font-family:system-ui;font-size:12px;padding:2px 0">
            <div style="font-weight:600;margin-bottom:2px">${asset.properties?.name || asset.properties?.Name || 'Cable'}</div>
            <div style="color:#64748b">${asset.properties?.owner || asset.properties?.networktype || asset.type}</div>
          </div>`,
        })
        polyline.addListener('click', (e: any) => {
          info.setPosition(e.latLng)
          info.open(map)
        })
        newOverlays.push(polyline)
        path.forEach(c => bounds.extend(c))
      }

      const drawPolygon = (paths: { lat: number; lng: number }[][]) => {
        const polygon = new google.maps.Polygon({
          paths,
          strokeColor: color,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.2,
          map,
        })
        newOverlays.push(polygon)
        paths.flat().forEach(c => bounds.extend(c))
      }

      const drawGeometry = (g: any) => {
        if (!g) return
        if (g.type === 'Point') {
          drawPoint(g.coordinates)
        } else if (g.type === 'MultiPoint') {
          g.coordinates.forEach(drawPoint)
        } else if (g.type === 'LineString') {
          drawLine(g.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] })))
        } else if (g.type === 'MultiLineString') {
          g.coordinates.forEach((line: number[][]) =>
            drawLine(line.map(c => ({ lat: c[1], lng: c[0] }))))
        } else if (g.type === 'Polygon') {
          drawPolygon(g.coordinates.map((ring: number[][]) => ring.map(c => ({ lat: c[1], lng: c[0] }))))
        } else if (g.type === 'MultiPolygon') {
          g.coordinates.forEach((poly: number[][][]) =>
            drawPolygon(poly.map(ring => ring.map(c => ({ lat: c[1], lng: c[0] })))))
        } else if (g.type === 'GeometryCollection') {
          g.geometries?.forEach(drawGeometry)
        }
      }

      drawGeometry(geom)
    }

    setOverlays(newOverlays)
    if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 })
  }, [map, assets, datasets, styleMode, stats])

  useEffect(() => {
    if (map && selectedAsset) {
      const g = selectedAsset.geometry
      if (!g) return
      if (g.type === 'Point') {
        map.panTo({ lat: g.coordinates[1], lng: g.coordinates[0] })
        map.setZoom(15)
      } else {
        const bounds = new google.maps.LatLngBounds()
        const walk = (geom: any) => {
          if (!geom) return
          if (geom.type === 'GeometryCollection') return geom.geometries?.forEach(walk)
          const flatten = (c: any): number[][] => {
            if (!Array.isArray(c)) return []
            if (typeof c[0] === 'number') return [c as number[]]
            return c.flatMap(flatten)
          }
          flatten(geom.coordinates).forEach(c => bounds.extend({ lat: c[1], lng: c[0] }))
        }
        walk(g)
        if (!bounds.isEmpty()) map.fitBounds(bounds)
      }
    }
  }, [map, selectedAsset])

  return <div ref={ref} style={{ height: '100%', width: '100%' }} />
}

function MapComponent({
  assets,
  datasets,
  selectedAsset,
  onDatasetSelect,
  styleMode,
  stats,
}: {
  assets: Asset[]
  datasets: Dataset[]
  selectedAsset?: Asset
  onDatasetSelect?: (id: number) => void
  styleMode: StyleMode
  stats: Stats
}) {
  const render = (status: Status) => {
    switch (status) {
      case Status.LOADING:
        return (
          <div className="flex h-full w-full items-center justify-center bg-slate-50">
            <div className="flex flex-col items-center gap-2">
              <svg className="h-6 w-6 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-xs text-slate-400">Loading map...</p>
            </div>
          </div>
        )
      case Status.FAILURE:
        return (
          <div className="flex h-full w-full items-center justify-center bg-slate-50">
            <div className="flex flex-col items-center gap-2 text-center">
              <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <p className="text-xs text-red-500">Failed to load map</p>
            </div>
          </div>
        )
      case Status.SUCCESS:
        return (
          <MyMapComponent
            assets={assets}
            datasets={datasets}
            selectedAsset={selectedAsset}
            onDatasetSelect={onDatasetSelect}
            styleMode={styleMode}
            stats={stats}
          />
        )
    }
  }

  return (
    <Wrapper apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!} render={render} />
  )
}

export default MapComponent
