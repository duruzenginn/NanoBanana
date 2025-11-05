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
  // Separate results & states: prompt-only vs mockup-panel flows
  const [promptResultUrl, setPromptResultUrl] = useState('')
  const [mockupResultUrl, setMockupResultUrl] = useState('')
  const [loadingPrompt, setLoadingPrompt] = useState(false)
  const [loadingMockup, setLoadingMockup] = useState(false)
  const [errorPrompt, setErrorPrompt] = useState('')
  const [errorMockup, setErrorMockup] = useState('')
  const [selectedMockup, setSelectedMockup] = useState(null)
  const [mockupPrompt, setMockupPrompt] = useState('')

  const canSubmit = useMemo(() => prompt.trim().length > 0 && !loadingPrompt, [prompt, loadingPrompt])

  const handleGenerate = async () => {
    if (!canSubmit) return
    setLoadingPrompt(true)
    setErrorPrompt('')
    setPromptResultUrl('')
    try {
      const resp = await fetch('/api/generateImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style: style || undefined,
          aspectRatio: aspect || undefined,
        })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`)
      const { imageBase64, mimeType } = data
      if (!imageBase64) throw new Error('No image returned from the model.')
      setPromptResultUrl(`data:${mimeType || 'image/png'};base64,${imageBase64}`)
    } catch (e) {
      setErrorPrompt(e.message || String(e))
    } finally {
      setLoadingPrompt(false)
    }
  }

  const handleNewPromptOnly = () => {
    setPromptResultUrl('')
  }
  const handleNewMockup = () => {
    setMockupResultUrl('')
  }

  const handleGenerateWithMockup = async () => {
    if (loadingMockup) return
    const p = mockupPrompt.trim()
    if (!p) return
    setLoadingMockup(true)
    setErrorMockup('')
    setMockupResultUrl('')
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
      setMockupResultUrl(`data:${mimeType || 'image/png'};base64,${imageBase64}`)
    } catch (e) {
      setErrorMockup(e.message || String(e))
    } finally {
      setLoadingMockup(false)
    }
  }

  const handleGenerateWithoutMockup = async () => {
    if (loadingMockup) return
    const p = mockupPrompt.trim()
    if (!p) return
    setLoadingMockup(true)
    setErrorMockup('')
    setMockupResultUrl('')
    try {
      const resp = await fetch('/api/generateImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: p,
          style: style || undefined,
          aspectRatio: aspect || undefined,
        })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`)
      const { imageBase64, mimeType } = data
      if (!imageBase64) throw new Error('No image returned from the model.')
      setMockupResultUrl(`data:${mimeType || 'image/png'};base64,${imageBase64}`)
    } catch (e) {
      setErrorMockup(e.message || String(e))
    } finally {
      setLoadingMockup(false)
    }
  }

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {}
  }
  const handleCopyMockupPrompt = async () => {
    try {
      await navigator.clipboard.writeText(mockupPrompt)
    } catch {}
  }

  const aspectPadding = useMemo(() => {
    // Convert aspect ratio like "16:9" to percentage padding-top for a responsive box
    const map = {
      '1:1': 100,
      '16:9': (9 / 16) * 100,
      '9:16': (16 / 9) * 100,
      '3:2': (2 / 3) * 100,
      '2:3': (3 / 2) * 100,
      '4:3': (3 / 4) * 100,
      '3:4': (4 / 3) * 100,
      '5:4': (4 / 5) * 100,
      '4:5': (5 / 4) * 100,
      '21:9': (9 / 21) * 100,
    }
    const v = aspect && map[aspect]
    return v || 56.25 // default to 16:9 feel when auto
  }, [aspect])

  return (
    <div className="min-h-screen bg-grid text-white">
      <Header />

      <main className="mx-auto max-w-[800px] px-4 py-8">
        <section className="glass p-6 md:p-8">
          <MockupSearch selected={selectedMockup} onSelect={setSelectedMockup} />
          <SelectedMockupPanel
            selected={selectedMockup}
            onClear={() => setSelectedMockup(null)}
            prompt={mockupPrompt}
            setPrompt={setMockupPrompt}
            onGenerate={handleGenerateWithMockup}
            onGenerateWithoutMockup={handleGenerateWithoutMockup}
            loading={loadingMockup}
          />
          {/* Mockup-section result box */}
          {loadingMockup && (
            <div className="mt-6 grid place-items-center">
              <div className="w-full max-w-[720px]">
                <div className="relative w-full rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                  <div style={{ paddingTop: `${aspectPadding}%` }} />
                  <div className="absolute inset-0 skeleton" />
                </div>
                <div className="mt-4 flex items-center gap-3 text-sm text-white/80">
                  <LoadingSpinner />
                  <span>Generating your image…</span>
                </div>
              </div>
            </div>
          )}
          {!!errorMockup && (
            <div className="mt-4 glass p-4 border border-red-400/40 bg-red-500/10 text-red-200 rounded-xl">
              {errorMockup}
            </div>
          )}
          {!!mockupResultUrl && (
            <div className="mt-6">
              <ResultCard
                prompt={mockupPrompt}
                imageUrl={mockupResultUrl}
                onNew={handleNewMockup}
                onCopyPrompt={handleCopyMockupPrompt}
              />
            </div>
          )}
        </section>

        {/* Middle section intentionally left for future content */}

        {/* Moved Prompt controls to the bottom */}
        <section className="mt-6 glass p-6 md:p-8">
          <PromptForm
            prompt={prompt}
            setPrompt={setPrompt}
            style={style}
            setStyle={setStyle}
            aspect={aspect}
            setAspect={setAspect}
            canSubmit={canSubmit}
            loading={loadingPrompt}
            onSubmit={handleGenerate}
          />
          {/* Prompt-section result box */}
          {loadingPrompt && (
            <div className="mt-6 grid place-items-center">
              <div className="w-full max-w-[720px]">
                <div className="relative w-full rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                  <div style={{ paddingTop: `${aspectPadding}%` }} />
                  <div className="absolute inset-0 skeleton" />
                </div>
                <div className="mt-4 flex items-center gap-3 text-sm text-white/80">
                  <LoadingSpinner />
                  <span>Generating your image…</span>
                </div>
              </div>
            </div>
          )}
          {!!errorPrompt && (
            <div className="mt-4 glass p-4 border border-red-400/40 bg-red-500/10 text-red-200 rounded-xl">
              {errorPrompt}
            </div>
          )}
          {!!promptResultUrl && (
            <div className="mt-6">
              <ResultCard
                prompt={prompt}
                imageUrl={promptResultUrl}
                onNew={handleNewPromptOnly}
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
