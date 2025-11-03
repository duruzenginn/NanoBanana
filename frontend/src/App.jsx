import React, { useMemo, useState } from 'react'
import Header from './components/Header'
import PromptForm from './components/PromptForm'
import ResultCard from './components/ResultCard'
import LoadingSpinner from './components/LoadingSpinner'
import MockupSearch from './components/MockupSearch'
import SelectedMockupPanel from './components/SelectedMockupPanel'

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('')
  const [aspect, setAspect] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedMockup, setSelectedMockup] = useState(null)
  const [mockupPrompt, setMockupPrompt] = useState('')

  const canSubmit = useMemo(() => prompt.trim().length > 0 && !loading, [prompt, loading])

  const handleGenerate = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    setImageUrl('')
    try {
      const resp = await fetch('/api/generateImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style: style || undefined,
          aspectRatio: aspect || undefined,
          mockupImageUrl: selectedMockup?.imageUrl || selectedMockup?.previewUrl || selectedMockup?.thumbnailUrl || undefined,
        })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`)
      const { imageBase64, mimeType } = data
      if (!imageBase64) throw new Error('No image returned from the model.')
      setImageUrl(`data:${mimeType || 'image/png'};base64,${imageBase64}`)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleNew = () => {
    setImageUrl('')
    setSelectedMockup(null)
    setMockupPrompt('')
  }

  const handleGenerateWithMockup = async () => {
    if (loading) return
    const p = mockupPrompt.trim()
    if (!p) return
    setLoading(true)
    setError('')
    setImageUrl('')
    try {
      const resp = await fetch('/api/generateImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: p,
          style: style || undefined,
          aspectRatio: aspect || undefined,
          mockupImageUrl: selectedMockup?.imageUrl || selectedMockup?.previewUrl || selectedMockup?.thumbnailUrl || undefined,
        })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`)
      const { imageBase64, mimeType } = data
      if (!imageBase64) throw new Error('No image returned from the model.')
      setImageUrl(`data:${mimeType || 'image/png'};base64,${imageBase64}`)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {}
  }

  return (
    <div className="min-h-screen bg-grid text-white">
      <Header />

      <main className="mx-auto max-w-[800px] px-4 py-8">
        <section className="glass p-6 md:p-8">
          <PromptForm
            prompt={prompt}
            setPrompt={setPrompt}
            style={style}
            setStyle={setStyle}
            aspect={aspect}
            setAspect={setAspect}
            canSubmit={canSubmit}
            loading={loading}
            onSubmit={handleGenerate}
          />
          <div className="mt-6">
            <MockupSearch selected={selectedMockup} onSelect={setSelectedMockup} />
            <SelectedMockupPanel
              selected={selectedMockup}
              onClear={() => setSelectedMockup(null)}
              prompt={mockupPrompt}
              setPrompt={setMockupPrompt}
              onGenerate={handleGenerateWithMockup}
              loading={loading}
            />
          </div>
        </section>

        <section className="mt-6">
          {loading && (
            <div className="glass p-6 md:p-8 grid place-items-center">
              <div className="w-full max-w-[720px]">
                <div className="skeleton aspect-video" />
                <div className="mt-4 flex items-center gap-3 text-sm text-white/80">
                  <LoadingSpinner />
                  <span>Generating your image…</span>
                </div>
              </div>
            </div>
          )}

          {!!error && (
            <div className="glass p-4 border border-red-400/40 bg-red-500/10 text-red-200 rounded-xl">
              {error}
            </div>
          )}

          {!!imageUrl && (
            <div className="glass p-6 md:p-8">
              <ResultCard
                prompt={prompt}
                imageUrl={imageUrl}
                onNew={handleNew}
                onCopyPrompt={handleCopyPrompt}
              />
            </div>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-[800px] px-4 pb-10 pt-6 text-sm text-white/70 flex items-center justify-between">
  <p>© 2025 DuruBanana • Built with Firebase & Gemini</p>
        <div className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span>API ready</span>
        </div>
      </footer>
    </div>
  )
}
