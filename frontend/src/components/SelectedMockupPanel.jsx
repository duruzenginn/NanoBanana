import React from 'react'
import clsx from 'clsx'

export default function SelectedMockupPanel({ selected, onClear, prompt, setPrompt, onGenerate, loading }) {
	if (!selected) return null
	return (
		<div className="mt-6 grid gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
			<div className="flex items-start gap-3">
				<img
					src={selected.thumbnailUrl || selected.previewUrl || selected.imageUrl}
					alt={selected.title || 'Selected mockup'}
					className="h-20 w-20 rounded-lg object-cover border border-white/15"
				/>
				<div className="flex-1 min-w-0">
					<div className="flex items-center justify-between gap-3">
						<div className="truncate font-medium">{selected.title || 'Selected mockup'}</div>
						<button type="button" onClick={onClear} className="text-sm text-primary2 hover:text-white">Clear</button>
					</div>
					{selected.author && (
						<div className="text-xs text-white/60 truncate mt-0.5">{selected.author}</div>
					)}
					{selected.source && (
						<a href={selected.source} target="_blank" rel="noreferrer" className="text-xs text-white/60 hover:text-white/90">View on Freepik</a>
					)}
				</div>
			</div>

			<div className="grid gap-2">
				<label className="text-sm font-medium text-white/90">Prompt for this mockup</label>
				<textarea
					className="min-h-[100px] w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-primary/60"
					placeholder="Describe how you want to brand or modify this mockup…"
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
				/>
			</div>

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={onGenerate}
					disabled={loading || !prompt.trim()}
					className={clsx('btn-primary', (loading || !prompt.trim()) && 'opacity-60 pointer-events-none')}
				>
					Generate with this mockup
				</button>
				{loading && <span className="text-white/70 text-sm">This can take a few seconds…</span>}
			</div>
			<p className="text-xs text-white/70">We’ll send the selected mockup image plus this prompt to Gemini.</p>
		</div>
	)
}

