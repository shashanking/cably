import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Other heavy packages we tree-shake. @arcgis/core is NOT bundled at all —
  // it's loaded from Esri's CDN at runtime via window.require() in ArcGISMap.
  experimental: {
    optimizePackageImports: ['@turf/turf'],
  },

  // Skip type-check on Vercel (runs separately in the IDE). Next 16 removed
  // the `eslint` config key — ESLint no longer runs during `next build`.
  typescript: { ignoreBuildErrors: true },

  productionBrowserSourceMaps: false,
}

export default nextConfig
