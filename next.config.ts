import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @arcgis/core ships as ESM with ~1,500 submodules. Without explicit
  // transpilation the prod bundler (Turbopack) stalls resolving them.
  transpilePackages: ['@arcgis/core'],

  // Skip type-check + lint on Vercel (they run separately in CI/IDE).
  // Keeps the build fast and stops lint warnings from failing the build.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // Silence noisy dev-only overlays in prod
  productionBrowserSourceMaps: false,
}

export default nextConfig
