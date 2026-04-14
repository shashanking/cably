'use client'

import UploadForm from '../../components/UploadForm'
import AssetForm from '../../components/AssetForm'

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900">Upload & Import</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Add new datasets from QGIS exports or manually capture asset locations.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
            </svg>
            <h2 className="text-sm font-semibold text-slate-800">Upload File</h2>
          </div>
          <UploadForm />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <h2 className="text-sm font-semibold text-slate-800">Manual Entry</h2>
          </div>
          <AssetForm onAssetAdded={() => window.location.reload()} />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-4">
        <div>
          <p className="text-sm font-medium text-slate-800">Export to QGIS</p>
          <p className="text-xs text-slate-500 mt-0.5">Download the full dataset as KML for external GIS analysis</p>
        </div>
        <a
          href="/api/export-kml"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download KML
        </a>
      </div>
    </div>
  )
}
