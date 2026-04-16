'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Vendor {
  id: number
  name: string
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  notes: string | null
  asset_count: number
  total_cost: number
}

interface VendorForm {
  name: string
  contact_email: string
  contact_phone: string
  address: string
  notes: string
}

const emptyForm: VendorForm = { name: '', contact_email: '', contact_phone: '', address: '', notes: '' }

function formatCurrency(value: number) {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [form, setForm] = useState<VendorForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [tipDismissed, setTipDismissed] = useState(false)

  const fetchVendors = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/vendors')
      const data = await res.json()
      if (Array.isArray(data)) setVendors(data)
    } catch (err) {
      console.error('Failed to fetch vendors:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchVendors() }, [fetchVendors])

  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [feedback])

  const openAdd = () => {
    setEditingVendor(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (vendor: Vendor) => {
    setEditingVendor(vendor)
    setForm({
      name: vendor.name,
      contact_email: vendor.contact_email ?? '',
      contact_phone: vendor.contact_phone ?? '',
      address: vendor.address ?? '',
      notes: vendor.notes ?? '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingVendor(null)
    setForm(emptyForm)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      }

      const url = editingVendor ? `/api/vendors/${editingVendor.id}` : '/api/vendors'
      const method = editingVendor ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save vendor')
      }

      setFeedback({ type: 'success', message: editingVendor ? 'Vendor updated successfully' : 'Vendor created successfully' })
      closeModal()
      fetchVendors()
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save vendor' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (vendor: Vendor) => {
    if (!confirm(`Delete vendor "${vendor.name}"? This action cannot be undone.`)) return

    setDeleting(vendor.id)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, { method: 'DELETE' })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete vendor')
      }

      setFeedback({ type: 'success', message: 'Vendor deleted successfully' })
      fetchVendors()
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to delete vendor' })
    } finally {
      setDeleting(null)
    }
  }

  const totalVendors = vendors.length
  const totalAssets = vendors.reduce((sum, v) => sum + v.asset_count, 0)
  const totalCost = vendors.reduce((sum, v) => sum + v.total_cost, 0)

  return (
    <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl p-6">
        {/* Feedback Toast */}
        {feedback && (
          <div className={`fixed top-16 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
            feedback.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {feedback.message}
          </div>
        )}

        {/* Dismissable Help Banner */}
        {!tipDismissed && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-start gap-3">
            <svg className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">Tip: Getting started with vendors</p>
              <p className="text-sm text-blue-700 mt-1">
                Add vendors first, then link them to assets in the Asset Editor. Vendor costs are automatically aggregated across all linked assets.
              </p>
            </div>
            <button
              onClick={() => setTipDismissed(true)}
              className="text-blue-400 hover:text-blue-600 transition-colors shrink-0"
              title="Dismiss tip"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Vendor Management</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage your network infrastructure vendors. Link vendors to fiber routes and assets to track costs, responsibilities, and vendor dependencies.
            </p>
          </div>
          <button
            onClick={openAdd}
            title="Add a new vendor to your network"
            className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Vendor
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Total Vendors</p>
            <p className="text-2xl font-bold font-mono text-blue-600">{totalVendors}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Linked Assets</p>
            <p className="text-2xl font-bold font-mono text-emerald-600">{totalAssets}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Total Cost</p>
            <p className="text-2xl font-bold font-mono text-amber-600">{formatCurrency(totalCost)}</p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-sm text-slate-500">Loading vendors...</span>
            </div>
          ) : vendors.length === 0 ? (
            <div className="text-center py-20 px-6">
              <svg className="mx-auto h-12 w-12 text-slate-300 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
              </svg>
              <p className="text-sm font-medium text-slate-700 mb-1">No vendors yet</p>
              <p className="text-sm text-slate-500 mb-4 max-w-sm mx-auto">
                Vendors represent the companies that supply your network infrastructure. Add your first vendor to start tracking costs and responsibilities.
              </p>
              <button
                onClick={openAdd}
                title="Add your first vendor"
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Your First Vendor
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400" title="The company or organization name of the vendor">Name</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400" title="Primary contact email address for this vendor">Email</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400" title="Contact phone number for this vendor">Phone</th>
                  <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400" title="Number of infrastructure assets linked to this vendor">Assets</th>
                  <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400" title="Aggregate cost of all assets linked to this vendor">Total Cost</th>
                  <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400" title="Available actions for this vendor">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vendors.map(vendor => (
                  <tr key={vendor.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-900">{vendor.name}</td>
                    <td className="px-5 py-3.5 text-slate-600">{vendor.contact_email || <span className="text-slate-300">--</span>}</td>
                    <td className="px-5 py-3.5 text-slate-600">{vendor.contact_phone || <span className="text-slate-300">--</span>}</td>
                    <td className="px-5 py-3.5 text-right font-mono">
                      {vendor.asset_count > 0 ? (
                        <Link
                          href={`/assets?vendor=${vendor.id}`}
                          title={`View ${vendor.asset_count} asset${vendor.asset_count !== 1 ? 's' : ''} from ${vendor.name}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {vendor.asset_count}
                        </Link>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-slate-700">{formatCurrency(vendor.total_cost)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/assets?vendor=${vendor.id}`}
                          title={`View assets from ${vendor.name}`}
                          className="h-7 px-2.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors inline-flex items-center"
                        >
                          View Assets
                        </Link>
                        <button
                          onClick={() => openEdit(vendor)}
                          title={`Edit vendor ${vendor.name}`}
                          className="h-7 px-2.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(vendor)}
                          disabled={deleting === vendor.id}
                          title={`Delete vendor ${vendor.name}`}
                          className="h-7 px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                        >
                          {deleting === vendor.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Link to Assets */}
        <div className="mt-6 text-center">
          <p className="text-sm text-slate-500">
            Need to assign vendors to assets?{' '}
            <Link href="/assets" className="text-blue-600 hover:text-blue-800 font-medium hover:underline">
              Go to Assets &rarr;
            </Link>
          </p>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={closeModal}>
          <div
            className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-xl p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-900">
                {editingVendor ? 'Edit Vendor' : 'Add Vendor'}
              </h2>
              <button onClick={closeModal} title="Close dialog" className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Vendor name"
                />
                <p className="mt-1 text-[11px] text-slate-400">Company or organization name</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={form.contact_email}
                    onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    placeholder="email@example.com"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">Primary contact email for this vendor</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Phone</label>
                  <input
                    type="tel"
                    value={form.contact_phone}
                    onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    placeholder="+1 (555) 000-0000"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">Contact phone number</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Street, City, State"
                />
                <p className="mt-1 text-[11px] text-slate-400">Business address</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                  placeholder="Additional notes..."
                />
                <p className="mt-1 text-[11px] text-slate-400">Additional notes, contract references, SLA details</p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  title="Cancel and close this dialog"
                  className="h-9 px-4 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.name.trim()}
                  title={editingVendor ? 'Save changes to this vendor' : 'Create a new vendor'}
                  className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {saving ? 'Saving...' : editingVendor ? 'Update Vendor' : 'Create Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
