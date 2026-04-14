'use client'

import { useEffect, useMemo, useState } from 'react'
import MapComponent, { Asset, Dataset } from '../../components/MapComponent'
import AssetList from '../../components/AssetList'
import { computeStats } from '../../lib/styling'

export default function AssetsPage() {
  const [selectedAsset, setSelectedAsset] = useState<Asset | undefined>()
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [assets, setAssets] = useState<Asset[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])

  useEffect(() => {
    fetch('/api/datasets')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setDatasets(d) })
      .catch(console.error)
    fetch('/api/assets')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAssets(d) })
      .catch(console.error)
  }, [refreshTrigger])

  const stats = useMemo(() => computeStats(assets), [assets])

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="w-[360px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Asset Explorer</h2>
          <p className="text-xs text-slate-500 mt-0.5">Select an asset to locate it on the map</p>
        </div>
        <div className="flex-1 overflow-auto p-3">
          <AssetList onSelectAsset={setSelectedAsset} refreshTrigger={refreshTrigger} />
        </div>
      </div>

      <div className="flex-1 relative">
        <MapComponent
          assets={assets}
          datasets={datasets}
          selectedAsset={selectedAsset}
          styleMode="original"
          stats={stats}
        />
        {selectedAsset && (
          <div className="absolute bottom-4 left-4 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="text-xs font-semibold text-slate-900">{selectedAsset.properties?.name || `Asset ${selectedAsset.id}`}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{selectedAsset.type} &middot; {selectedAsset.geometry.type}</div>
          </div>
        )}
      </div>
    </div>
  )
}
