// Shared geodesy utilities used by both client and server

export function haversineKm(c1: number[], c2: number[]): number {
  const R = 6371
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(c2[1] - c1[1])
  const dLon = toRad(c2[0] - c1[0])
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(c1[1])) * Math.cos(toRad(c2[1])) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function geomLengthKm(geometry: any): number {
  if (!geometry) return 0
  if (geometry.type === 'LineString') {
    let km = 0
    const coords = geometry.coordinates || []
    for (let i = 0; i < coords.length - 1; i++) km += haversineKm(coords[i], coords[i + 1])
    return km
  }
  if (geometry.type === 'MultiLineString') {
    return (geometry.coordinates || []).reduce((s: number, line: number[][]) => {
      let km = 0
      for (let i = 0; i < line.length - 1; i++) km += haversineKm(line[i], line[i + 1])
      return s + km
    }, 0)
  }
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).reduce((s: number, g: any) => s + geomLengthKm(g), 0)
  }
  return 0
}
