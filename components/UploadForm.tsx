'use client'

import { useState, useRef } from 'react'

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setUploading(true); setMessage('')
    const formData = new FormData(); formData.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) { setMessage(data.message || 'Upload successful'); setMessageType('success'); setFile(null); if (inputRef.current) inputRef.current.value = ''; window.location.reload() }
      else { setMessage(data.error || 'Upload failed'); setMessageType('error') }
    } catch { setMessage('Upload failed'); setMessageType('error') }
    finally { setUploading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f && /\.(kml|kmz|geojson|csv)$/i.test(f.name)) setFile(f) }} onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 transition ${dragOver ? 'border-blue-400 bg-blue-50' : file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/30'}`}>
        <span className="text-2xl">{file ? '✅' : '📁'}</span>
        <div className="text-center">
          {file ? <><p className="text-sm font-medium text-emerald-700">{file.name}</p><p className="text-xs text-slate-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p></> : <><p className="text-sm text-slate-600">Drop a file here or <span className="text-blue-600 font-medium">browse</span></p><p className="text-xs text-slate-400 mt-0.5">KML, KMZ, GeoJSON, or CSV</p></>}
        </div>
        <input ref={inputRef} type="file" accept=".kml,.kmz,.geojson,.csv" onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!file || uploading} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">{uploading ? 'Uploading...' : 'Upload to Database'}</button>
        {message && <p className={`text-xs ${messageType === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>{message}</p>}
      </div>
    </form>
  )
}
