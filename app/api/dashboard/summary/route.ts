import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AssetRow = {
  id: number
  type: string | null
  name: string | null
  status: string | null
  operational_status: string | null
  utilization_pct: number | null
  capacity_pct: number | null
  vendor_id: number | null
  cost_per_km: number | null
  total_cost: number | null
  length_km: number | null
  region: string | null
  installed_year: number | null
  created_at: string
}

async function fetchAllAssets(): Promise<AssetRow[]> {
  const COLS = 'id, type, name, status, operational_status, utilization_pct, capacity_pct, vendor_id, cost_per_km, total_cost, length_km, region, installed_year, created_at'
  const PAGE = 1000
  let all: AssetRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('assets').select(COLS).range(from, from + PAGE - 1)
    if (error) {
      // Surface schema / permission errors instead of silently returning empty
      throw new Error(`Supabase: ${error.message}`)
    }
    if (!data || data.length === 0) break
    all = all.concat(data as AssetRow[])
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// Treat fiber-like asset types as "routes". Everything else (POP / WC / DC / etc.)
// counts as a facility / node.
const ROUTE_TYPES = new Set(['owned', 'leased', 'waves', 'planned', 'fiber', 'cable', 'other'])
const FACILITY_TYPES = new Set(['pops', 'wirecenters', 'colo', 'datacenters'])

function isRoute(t: string | null): boolean {
  if (!t) return false
  return ROUTE_TYPES.has(t.toLowerCase()) || !FACILITY_TYPES.has(t.toLowerCase())
}

function pct(n: number, d: number): number {
  if (!d) return 0
  return Math.round((n / d) * 1000) / 10  // one decimal
}

export async function GET() {
  try {
    const [assets, vendorsRes, plansRes] = await Promise.all([
      fetchAllAssets(),
      supabase.from('vendors').select('id, name'),
      supabase.from('plans').select('*').order('target_year', { ascending: true }),
    ])

    const vendorMap = new Map<number, string>()
    for (const v of vendorsRes.data || []) vendorMap.set((v as any).id, (v as any).name)

    const plans = (plansRes.data as any[]) || []
    const activePlan = plans.find(p => p.target_year >= new Date().getFullYear()) || plans[0] || null

    // ── KPIs ────────────────────────────────────────────────────────────────
    const routes = assets.filter(a => isRoute(a.type))
    const activeRoutes = routes.filter(a => (a.operational_status || 'online') === 'online').length
    const totalCost = assets.reduce((s, a) => s + (Number(a.total_cost) || 0), 0)
    const totalLengthKm = routes.reduce((s, a) => s + (Number(a.length_km) || 0), 0)
    const plannedLengthKm = routes
      .filter(a => (a.status || '').toLowerCase() === 'planned')
      .reduce((s, a) => s + (Number(a.length_km) || 0), 0)
    const networkCoveragePct = routes.length
      ? pct(routes.filter(a => (a.operational_status || 'online') === 'online').length, routes.length)
      : 0

    // ── YoY from created_at ────────────────────────────────────────────────
    const now = Date.now()
    const YEAR_MS = 365 * 24 * 3600 * 1000
    const assetsThisYear = assets.filter(a => new Date(a.created_at).getTime() >= now - YEAR_MS)
    const assetsLastYear = assets.filter(a => {
      const t = new Date(a.created_at).getTime()
      return t >= now - 2 * YEAR_MS && t < now - YEAR_MS
    })
    const milesThisYear = assetsThisYear.reduce((s, a) => s + (Number(a.length_km) || 0), 0)
    const milesLastYear = assetsLastYear.reduce((s, a) => s + (Number(a.length_km) || 0), 0)
    const milesYoyPct = milesLastYear > 0 ? pct(milesThisYear - milesLastYear, milesLastYear) : null
    const costThisYear = assetsThisYear.reduce((s, a) => s + (Number(a.total_cost) || 0), 0)
    const costLastYear = assetsLastYear.reduce((s, a) => s + (Number(a.total_cost) || 0), 0)
    const costYoyPct = costLastYear > 0 ? pct(costThisYear - costLastYear, costLastYear) : null

    // ── Network Composition (by type, lengths) ─────────────────────────────
    const compositionMap = new Map<string, { miles: number; count: number }>()
    for (const a of routes) {
      const key = (a.type || 'other').toLowerCase()
      const c = compositionMap.get(key) || { miles: 0, count: 0 }
      c.miles += Number(a.length_km) || 0
      c.count += 1
      compositionMap.set(key, c)
    }
    const composition = Array.from(compositionMap.entries()).map(([type, v]) => ({
      type, miles: Math.round(v.miles * 10) / 10, count: v.count,
      share: totalLengthKm ? pct(v.miles, totalLengthKm) : 0,
    })).sort((a, b) => b.miles - a.miles)

    // ── Owned vs Leased share (for bottom-strip bars) ──────────────────────
    const ownedMiles = compositionMap.get('owned')?.miles || 0
    const leasedMiles = compositionMap.get('leased')?.miles || 0
    const ownedPct = totalLengthKm ? pct(ownedMiles, totalLengthKm) : 0
    const leasedPct = totalLengthKm ? pct(leasedMiles, totalLengthKm) : 0

    // ── Vendor Cost Comparison (annual) ────────────────────────────────────
    const vendorCostMap = new Map<number, { name: string; cost: number; miles: number }>()
    for (const a of assets) {
      if (a.vendor_id == null) continue
      const name = vendorMap.get(a.vendor_id) || `Vendor #${a.vendor_id}`
      const v = vendorCostMap.get(a.vendor_id) || { name, cost: 0, miles: 0 }
      v.cost += Number(a.total_cost) || 0
      v.miles += Number(a.length_km) || 0
      vendorCostMap.set(a.vendor_id, v)
    }
    const vendorCosts = Array.from(vendorCostMap.values())
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)

    // ── Cost Per Mile by Route (top rows, highest $/mile) ──────────────────
    const costPerMile = routes
      .filter(a => a.length_km && (a.total_cost || a.cost_per_km))
      .map(a => {
        const lengthMi = Number(a.length_km) * 0.621371
        const perMile = a.cost_per_km != null
          ? Number(a.cost_per_km) / 0.621371  // convert $/km → $/mi
          : (Number(a.total_cost) || 0) / Math.max(lengthMi, 0.01)
        return {
          id: a.id,
          name: a.name || `Route #${a.id}`,
          vendor: a.vendor_id != null ? (vendorMap.get(a.vendor_id) || '—') : '—',
          distance_mi: Math.round(lengthMi * 10) / 10,
          total_cost: Math.round(Number(a.total_cost) || perMile * lengthMi),
          cost_per_mile: Math.round(perMile),
          status: a.status || 'active',
          utilization_pct: a.utilization_pct != null ? Number(a.utilization_pct) : null,
        }
      })
      .sort((a, b) => b.cost_per_mile - a.cost_per_mile)
      .slice(0, 8)

    // ── Facility summary (for vendor/facility dashboard later, included here) ──
    const facilityMap = new Map<string, { total: number; online: number; offline: number; warning: number; capacity: number[]; utilization: number[] }>()
    for (const a of assets) {
      const t = (a.type || '').toLowerCase()
      if (!FACILITY_TYPES.has(t)) continue
      const f = facilityMap.get(t) || { total: 0, online: 0, offline: 0, warning: 0, capacity: [], utilization: [] }
      f.total += 1
      const op = (a.operational_status || 'online').toLowerCase()
      if (op === 'online') f.online += 1
      else if (op === 'offline') f.offline += 1
      else f.warning += 1
      if (a.capacity_pct != null) f.capacity.push(Number(a.capacity_pct))
      if (a.utilization_pct != null) f.utilization.push(Number(a.utilization_pct))
      facilityMap.set(t, f)
    }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : 0
    const facilities = Array.from(facilityMap.entries()).map(([type, f]) => ({
      type, total: f.total, online: f.online, offline: f.offline, warning: f.warning,
      capacity: avg(f.capacity), utilization: avg(f.utilization),
    }))

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      kpis: {
        networkCoveragePct,
        activeRoutes,
        totalCost: Math.round(totalCost),
        totalLengthKm: Math.round(totalLengthKm * 10) / 10,
        plannedLengthKm: Math.round(plannedLengthKm * 10) / 10,
        costPerMile: totalLengthKm ? Math.round(totalCost / (totalLengthKm * 0.621371)) : 0,
      },
      trends: {
        milesYoyPct,
        costYoyPct,
        milesAddedYtd: Math.round(milesThisYear * 0.621371),
      },
      composition,
      ownedVsLeased: { ownedPct, leasedPct },
      vendorCosts,
      costPerMile,
      facilities,
      activePlan,
      plans,
    })
  } catch (err: any) {
    console.error('[dashboard/summary] aggregation failed', err)
    return NextResponse.json({ error: err.message || 'dashboard aggregation failed' }, { status: 500 })
  }
}
