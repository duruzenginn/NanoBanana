import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'

// A simple mockup search UI that calls our backend proxy at /api/freepik/search
// Exposes the selected item to parent via onSelect
export default function MockupSearch({ onSelect, selected, className }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSearch = useMemo(() => q.trim().length >= 2 && !loading, [q, loading])

  const search = async (resetPage = true) => {
    if (!canSearch) return
    setLoading(true)
    setError('')
    try {
      const p = resetPage ? 1 : page
      const resp = await fetch(`/api/freepik/search?q=${encodeURIComponent(q.trim())}&page=${p}&limit=24`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || `Search failed (${resp.status})`)

      // Freepik response structure can vary; try a few common shapes
      const items = normalizeFreepikItems(data)
      setResults(items)
      if (resetPage) setPage(1)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const clearSelection = () => onSelect?.(null)

  return (
    <div className={className}>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-white/90">Search Mockups (Freepik)</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="e.g. t-shirt mockup, poster mockup"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-primary/60"
          />
          <button
            type="button"
            onClick={() => search(true)}
            disabled={!canSearch}
            className="action-btn inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-white/10 border border-white/15 hover:bg-white/15 disabled:opacity-50"
          >
            <MagnifyingGlassIcon className="h-5 w-5" />
            Search
          </button>
        </div>
        {selected && (
          <div className="mt-2 flex items-center gap-3 text-sm text-white/80">
            <img src={selected.thumbnailUrl || selected.previewUrl || selected.imageUrl} alt="Selected mockup" className="h-12 w-12 rounded-lg object-cover border border-white/15" />
            <div className="flex-1 min-w-0">
              <div className="truncate">{selected.title || 'Selected mockup'}</div>
              <div className="text-white/60 text-xs truncate">{selected.author || selected.source || ''}</div>
            </div>
            <button onClick={clearSelection} className="inline-flex items-center gap-1 text-primary2 hover:text-white">
              <XMarkIcon className="h-5 w-5" />
              Clear
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="mt-4 text-white/80 text-sm">Searching…</div>
      )}
      {!!error && (
        <div className="mt-3 text-sm text-red-200 bg-red-500/10 border border-red-400/40 rounded-xl px-3 py-2">{error}</div>
      )}

      {!loading && results?.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect?.(item)}
              className="group text-left rounded-xl overflow-hidden border border-white/10 bg-white/5 hover:bg-white/10 focus:ring-2 focus:ring-primary/60"
              title={item.title}
            >
              <div className="aspect-square bg-black/20 overflow-hidden">
                <img src={item.thumbnailUrl || item.previewUrl || item.imageUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              </div>
              <div className="px-2.5 py-2 text-xs text-white/80 truncate">{item.title || 'Untitled'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function normalizeFreepikItems(payload) {
  // Try to map various possible response shapes to a common array
  // Adjust this according to your Freepik API plan/response.
  if (!payload) return []
  let arr = []
  if (Array.isArray(payload?.data)) arr = payload.data
  else if (Array.isArray(payload?.items)) arr = payload.items
  else if (Array.isArray(payload?.results)) arr = payload.results

  return arr.map((it, idx) => {
    const id = it.id || it?.hash_id || `${idx}`
    const title = it.title || it?.name || it?.description || 'Mockup'
    // Freepik /v1/resources shape often puts image at it.image.source.url
    const imageSourceUrl = it?.image?.source?.url
    const thumb = it?.thumb_url || it?.thumbnail || it?.images?.preview || it?.images?.['64x64'] || it?.assets?.preview?.url || imageSourceUrl
    const preview = it?.preview_url || it?.images?.['240_F'] || it?.images?.['500_F'] || it?.assets?.preview_1000?.url || imageSourceUrl
    const imageUrl = it?.image_url || preview || thumb || it?.url
    const author = it?.author || it?.creator || it?.owner || it?.uploader || ''

    return {
      id,
      title,
      thumbnailUrl: thumb || imageUrl,
      previewUrl: preview || imageUrl,
      imageUrl,
      author,
      source: it?.url || it?.link || '',
      raw: it,
    }
  })
}
