import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @arcgis/core ships as ESM with ~1,500 submodules. `optimizePackageImports`
  // tells Next/Turbopack to only bundle the specific submodules we actually
  // import at runtime (via `await import(...)`), not the entire graph.
  experimental: {
    optimizePackageImports: ['@arcgis/core', '@turf/turf'],
  },

  // Skip type-check on Vercel (runs separately in the IDE). Next 16 removed
  // the `eslint` config key — ESLint no longer runs during `next build`.
  typescript: { ignoreBuildErrors: true },

  // Silence noisy dev-only overlays in prod
  productionBrowserSourceMaps: false,
}

export default nextConfig
