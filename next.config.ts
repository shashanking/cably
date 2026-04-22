import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @arcgis/core ships as ESM with ~1,500 submodules. `optimizePackageImports`
  // tells Next/Turbopack to only bundle the specific submodules we actually
  // import at runtime (via `await import(...)`), not the entire graph.
  experimental: {
    optimizePackageImports: ['@arcgis/core', '@turf/turf'],
  },

  // Skip type-check + lint on Vercel (they run separately in CI/IDE).
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // Silence noisy dev-only overlays in prod
  productionBrowserSourceMaps: false,
}

export default nextConfig
