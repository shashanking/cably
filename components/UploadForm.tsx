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

    setUploading(true)
    setMessage('')
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })
      const data = await res.json()
      if (res.ok) {
        setMessage(data.message || 'Upload successful')
        setMessageType('success')
        setFile(null)
        if (inputRef.current) inputRef.current.value = ''
        window.location.reload()
      } else {
        setMessage(data.error || 'Upload failed')
        setMessageType('error')
      }
    } catch (error) {
      setMessage('Upload failed')
      setMessageType('error')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && /\.(kml|kmz|geojson)$/i.test(droppedFile.name)) {
      setFile(droppedFile)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition ${
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : file
              ? 'border-green-300 bg-green-50'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100'
        }`}
      >
        {file ? (
          <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        ) : (
          <svg className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
          </svg>
        )}
        <div className="text-center">
          {file ? (
            <>
              <p className="text-sm font-medium text-green-700">{file.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">Drop a file here or <span className="text-blue-600 font-medium">browse</span></p>
              <p className="text-xs text-slate-400 mt-0.5">KML, KMZ, or GeoJSON</p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".kml,.kmz,.geojson"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="hidden"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!file || uploading}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        {message && (
          <p className={`text-xs ${messageType === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {message}
          </p>
        )}
      </div>
    </form>
  )
}
