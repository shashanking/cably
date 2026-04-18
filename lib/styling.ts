export type StyleMode = 'original' | 'owner' | 'status' | 'placement' | 'age' | 'length'

export const STYLE_MODES: { id: StyleMode; label: string; help: string }[] = [
  { id: 'original', label: 'Original KML', help: 'Colors from the source file' },
  { id: 'owner', label: 'Owner', help: 'Color by cable owner' },
  { id: 'status', label: 'Status', help: 'Active / retired / construction' },
  { id: 'placement', label: 'Placement', help: 'Aerial / underground / buried' },
  { id: 'age', label: 'Install year', help: 'Old \u2192 new gradient' },
  { id: 'length', label: 'Length', help: 'Width scales with optical length' },
]

export const PALETTE = [
  '#2563eb', '#16a34a', '#dc2626', '#ea580c', '#ca8a04',
  '#9333ea', '#0891b2', '#be123c', '#65a30d', '#7c3aed',
  '#0ea5e9', '#db2777', '#059669', '#f59e0b', '#475569',
]

export const FALLBACK = '#94a3b8'

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function categoricalColor(value: unknown): string {
  if (value == null || value === '') return FALLBACK
  return PALETTE[hashString(String(value)) % PALETTE.length]
}

export function ageColor(year: number, minYear: number, maxYear: number): string {
  if (!Number.isFinite(year) || minYear === maxYear) return FALLBACK
  const t = Math.max(0, Math.min(1, (year - minYear) / (maxYear - minYear)))
  // old (t=0) → red, new (t=1) → green
  const r = Math.round(220 - t * 180)
  const g = Math.round(60 + t * 140)
  const b = Math.round(60 + t * 30)
  return `rgb(${r},${g},${b})`
}

export function lengthWidth(len: number, minLen: number, maxLen: number): number {
  if (!Number.isFinite(len) || maxLen === minLen) return 3
  const t = Math.sqrt((len - minLen) / (maxLen - minLen))
  return 2 + t * 8
}

export interface Stats {
  owners: string[]
  statuses: string[]
  placements: string[]
  yearMin: number
  yearMax: number
  lengthMin: number
  lengthMax: number
  topFolders: string[]
}

function numericFrom(v: unknown): number {
  if (v == null || v === '') return NaN
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : NaN
}

export function getStatusValue(p: any): string | null {
  return p?.Status || p?.construction_status || p?.stage || null
}

const OWNER_KEY_PATTERNS = [
  /^owner$/i, /^owned_?by$/i, /^owning[_\s]?(company|org|entity)$/i,
  /^ownership$/i, /^own(er)?[_\s]?name$/i, /^owner_?org(anization)?$/i,
  /^maintained[_\s]?by$/i, /^maintainer$/i, /^operator$/i, /^operated[_\s]?by$/i,
  /^carrier$/i, /^provider$/i, /^company$/i, /^org(anization)?$/i, /^proprietor$/i,
]

export function getOwnerValue(p: any): string | null {
  if (!p || typeof p !== 'object') return null
  for (const key of Object.keys(p)) {
    if (OWNER_KEY_PATTERNS.some(r => r.test(key))) {
      const v = p[key]
      if (v != null && v !== '') return String(v).trim()
    }
  }
  return null
}

export function getPlacementValue(p: any): string | null {
  return p?.placement || p?.rowtype || null
}

export function getInstallYear(p: any): number {
  return numericFrom(p?.installyear)
}

export function getLength(p: any): number {
  const v = numericFrom(p?.opticallength)
  if (Number.isFinite(v)) return v
  return numericFrom(p?.sheathlength)
}

export function computeStats(assets: Array<{ properties: any }>): Stats {
  const owners = new Set<string>()
  const statuses = new Set<string>()
  const placements = new Set<string>()
  const folders = new Set<string>()
  let yearMin = Infinity, yearMax = -Infinity
  let lengthMin = Infinity, lengthMax = -Infinity

  for (const a of assets) {
    const p = a.properties || {}
    const o = getOwnerValue(p); if (o) owners.add(o)
    const s = getStatusValue(p); if (s) statuses.add(s)
    const pl = getPlacementValue(p); if (pl) placements.add(pl)
    const y = getInstallYear(p)
    if (Number.isFinite(y)) { if (y < yearMin) yearMin = y; if (y > yearMax) yearMax = y }
    const len = getLength(p)
    if (Number.isFinite(len) && len > 0) { if (len < lengthMin) lengthMin = len; if (len > lengthMax) lengthMax = len }
    const folder = Array.isArray(p.__folder) ? p.__folder[0] : null
    if (folder) folders.add(folder)
  }

  return {
    owners: [...owners].sort(),
    statuses: [...statuses].sort(),
    placements: [...placements].sort(),
    yearMin: yearMin === Infinity ? 0 : yearMin,
    yearMax: yearMax === -Infinity ? 0 : yearMax,
    lengthMin: lengthMin === Infinity ? 0 : lengthMin,
    lengthMax: lengthMax === -Infinity ? 0 : lengthMax,
    topFolders: [...folders].sort(),
  }
}

export function assetColor(asset: { properties: any; type?: string }, mode: StyleMode, stats: Stats): string {
  const p = asset.properties || {}
  switch (mode) {
    case 'original':
      return p.__color || FALLBACK
    case 'owner':
      return categoricalColor(getOwnerValue(p))
    case 'status':
      return categoricalColor(getStatusValue(p))
    case 'placement':
      return categoricalColor(getPlacementValue(p))
    case 'age':
      return ageColor(getInstallYear(p), stats.yearMin, stats.yearMax)
    case 'length':
      return categoricalColor(getOwnerValue(p))
  }
}

export function assetWidth(asset: { properties: any }, mode: StyleMode, stats: Stats): number {
  if (mode === 'length') return lengthWidth(getLength(asset.properties || {}), stats.lengthMin, stats.lengthMax)
  return 3
}
