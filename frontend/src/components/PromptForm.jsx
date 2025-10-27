import React from 'react'
import clsx from 'clsx'
import { SparklesIcon } from '@heroicons/react/24/solid'

const STYLES = ['', 'realistic', 'artistic', 'cartoon', 'abstract', 'vintage', 'futuristic']
const RATIOS = [
  { v: '', label: 'Auto' },
  { v: '1:1', label: '1:1' },
  { v: '16:9', label: '16:9' },
  { v: '9:16', label: '9:16' },
  { v: '3:2', label: '3:2' },
  { v: '2:3', label: '2:3' },
  { v: '4:3', label: '4:3' },
  { v: '3:4', label: '3:4' },
  { v: '5:4', label: '5:4' },
  { v: '4:5', label: '4:5' },
  { v: '21:9', label: '21:9' }
]

const SAMPLES = [
  'A nano-banana dessert plated like fine dining, cinematic lighting, 50mm lens, bokeh background',
  'Cartoon nano-banana superhero flying over a neon city at night, vibrant colors, comic style',
  'Minimalist poster of a nano-banana with geometric shapes, clean lines, negative space',
  'Futuristic nano-banana robot chef in a glossy kitchen, reflections, ultra-detailed',
  'Vintage still-life photo of a nano-banana on a wooden table, soft morning light, film grain'
]

export default function PromptForm({ prompt, setPrompt, style, setStyle, aspect, setAspect, canSubmit, loading, onSubmit }) {
  const surprise = () => {
    const pick = SAMPLES[Math.floor(Math.random() * SAMPLES.length)]
    setPrompt(pick)
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <label className="text-sm font-medium text-white/90">Image Prompt</label>
        <textarea
          className="min-h-[120px] w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-primary/60"
          placeholder="Describe the image you want to generate…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex gap-2">
          <button type="button" onClick={surprise} className="btn-ghost text-white/90 hover:text-white">🎲 Surprise me</button>
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium text-white/90">Style (optional)</label>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => {
            const selected = s === style
            return (
              <button
                key={s || 'none'}
                type="button"
                aria-pressed={selected}
                onClick={() => setStyle(selected ? '' : s)}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 border transition',
                  'bg-white/5 border-white/10 text-white/90 hover:bg-white/10',
                  selected && 'border-primary2 ring-2 ring-primary2 bg-primary/30 text-white shadow-glow'
                )}
              >
                {selected && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-primary2" />}
                <span>{s || 'None'}</span>
              </button>
            )
          })}
        </div>
        {!!style && (
          <div className="text-xs text-white/80">
            Selected style:
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/30 px-2 py-0.5 text-white ring-1 ring-primary2/70">
              {style}
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium text-white/90">Aspect Ratio (optional)</label>
        <div className="flex flex-wrap gap-2">
          {RATIOS.map((r) => {
            const selected = r.v === aspect
            return (
              <button
                key={r.v || 'auto'}
                type="button"
                aria-pressed={selected}
                onClick={() => setAspect(selected ? '' : r.v)}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 border transition',
                  'bg-white/5 border-white/10 text-white/90 hover:bg-white/10',
                  selected && 'border-primary2 ring-2 ring-primary2 bg-primary/30 text-white shadow-glow'
                )}
              >
                {selected && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-primary2" />}
                <span>{r.label}</span>
              </button>
            )
          })}
        </div>
        {!!aspect && (
          <div className="text-xs text-white/80">
            Selected ratio:
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/30 px-2 py-0.5 text-white ring-1 ring-primary2/70">
              {aspect}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={clsx(
            'btn-primary',
            !loading && 'animate-pulseSoft',
            !canSubmit && 'opacity-60 pointer-events-none'
          )}
        >
          <SparklesIcon className="h-5 w-5" />
          Generate Image
        </button>
        {loading && <span className="text-white/70 text-sm">This can take a few seconds…</span>}
      </div>
    </div>
  )
}
