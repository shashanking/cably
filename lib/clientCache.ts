/**
 * Shared in-memory client cache for fetched API data.
 *
 * Survives React mount/unmount + route changes within the same SPA session.
 * Resets on hard reload. Backed by browser HTTP cache headers (the API routes
 * also send `stale-while-revalidate`) so even a full reload is fast.
 *
 * Usage:
 *   const data = await cachedFetch('vendors', () => fetch('/api/vendors').then(r => r.json()))
 *   invalidate('assets')           // after a mutation, clear all keys starting with 'assets'
 *   invalidate(['assets', 'dash']) // multiple prefixes at once
 */

type Entry<T> = { data: T; ts: number; ttl: number }

const DEFAULT_TTL_MS = 60_000
const cache = new Map<string, Entry<unknown>>()
const subs = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<unknown>>()

function isExpired(e: Entry<unknown>): boolean {
  return Date.now() - e.ts > e.ttl
}

export function getCached<T>(key: string): T | undefined {
  const e = cache.get(key) as Entry<T> | undefined
  if (!e) return undefined
  if (isExpired(e)) { cache.delete(key); return undefined }
  return e.data
}

export function setCached<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, { data, ts: Date.now(), ttl: ttlMs })
  notify(key)
}

export function invalidate(prefixOrPrefixes: string | string[]): void {
  const prefixes = Array.isArray(prefixOrPrefixes) ? prefixOrPrefixes : [prefixOrPrefixes]
  for (const key of Array.from(cache.keys())) {
    if (prefixes.some(p => key.startsWith(p))) cache.delete(key)
  }
  for (const key of Array.from(subs.keys())) {
    if (prefixes.some(p => key.startsWith(p))) notify(key)
  }
}

export function clearAll(): void {
  cache.clear()
  for (const key of subs.keys()) notify(key)
}

function notify(key: string): void {
  const set = subs.get(key)
  if (!set) return
  for (const fn of set) {
    try { fn() } catch (e) { console.error('cache subscriber error', e) }
  }
}

export function subscribe(key: string, fn: () => void): () => void {
  let set = subs.get(key)
  if (!set) { set = new Set(); subs.set(key, set) }
  set.add(fn)
  return () => {
    const s = subs.get(key)
    if (!s) return
    s.delete(fn)
    if (s.size === 0) subs.delete(key)
  }
}

/**
 * Cache-or-fetch with in-flight dedup. Two simultaneous calls with the same
 * key share a single network request.
 *
 * Pass `force: true` to skip the cache and refetch (still deduped).
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
  if (!opts.force) {
    const hit = getCached<T>(key)
    if (hit !== undefined) return hit
  }
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = fetcher()
    .then(data => { setCached(key, data, ttl); inflight.delete(key); return data })
    .catch(err => { inflight.delete(key); throw err })
  inflight.set(key, p)
  return p
}
