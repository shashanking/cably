'use client'

import Link from 'next/link'
import UploadForm from '../../components/UploadForm'
import AssetForm from '../../components/AssetForm'

export default function UploadPage() {
  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-slate-900">Upload & Import</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Import geospatial data files or manually add individual assets to your network database.
          </p>
        </div>

        {/* Help banner */}
        <div className="mb-6 bg-blue-50 border border-blue-100 rounded-xl px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-lg">💡</span>
            <div>
              <p className="text-sm font-medium text-blue-800 mb-1">Getting Started with Data Import</p>
              <ul className="text-xs text-blue-700 space-y-1 list-disc pl-4">
                <li><strong>KML/KMZ files</strong> — Export from QGIS, Google Earth, or other GIS tools. Folders become separate layers.</li>
                <li><strong>GeoJSON</strong> — Standard geospatial format from web mapping tools.</li>
                <li><strong>CSV</strong> — Must include <code className="bg-blue-100 px-1 rounded">latitude</code> and <code className="bg-blue-100 px-1 rounded">longitude</code> columns for point data.</li>
                <li>After upload, go to the <Link href="/" className="font-medium underline">Map</Link> to load and visualize your datasets.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">📡</span>
              <h2 className="text-sm font-semibold text-slate-800">Upload File</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4">Upload KML, KMZ, GeoJSON, or CSV files. Data is parsed and stored in the database.</p>
            <UploadForm />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">📌</span>
              <h2 className="text-sm font-semibold text-slate-800">Manual Entry</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4">Add individual point assets (POPs, towers, nodes) by entering coordinates manually.</p>
            <AssetForm onAssetAdded={() => window.location.reload()} />
          </div>
        </div>

        {/* After upload actions */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Link href="/" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-blue-300 hover:bg-blue-50/30 transition-colors no-underline group">
            <span className="text-2xl group-hover:scale-110 transition-transform">🗺️</span>
            <div>
              <p className="text-sm font-semibold text-slate-800">View on Map</p>
              <p className="text-xs text-slate-500 mt-0.5">Load datasets and visualize on the interactive map</p>
            </div>
          </Link>
          <Link href="/assets" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-blue-300 hover:bg-blue-50/30 transition-colors no-underline group">
            <span className="text-2xl group-hover:scale-110 transition-transform">📋</span>
            <div>
              <p className="text-sm font-semibold text-slate-800">Browse Assets</p>
              <p className="text-xs text-slate-500 mt-0.5">View, edit, and manage uploaded assets</p>
            </div>
          </Link>
          <Link href="/api/export-kml" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-blue-300 hover:bg-blue-50/30 transition-colors no-underline group">
            <span className="text-2xl group-hover:scale-110 transition-transform">📥</span>
            <div>
              <p className="text-sm font-semibold text-slate-800">Export KML</p>
              <p className="text-xs text-slate-500 mt-0.5">Download all data as KML for QGIS or Google Earth</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
