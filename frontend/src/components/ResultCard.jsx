import React from 'react'
import { ArrowDownTrayIcon, PlusIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'

export default function ResultCard({ prompt, imageUrl, onNew, onCopyPrompt }) {
  const download = () => {
    const a = document.createElement('a')
    a.href = imageUrl
    a.download = 'durubanana.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Generated Image</h3>
          <div className="mt-1 flex items-center gap-2 text-sm text-white/80">
            <span>Your prompt</span>
            <button onClick={onCopyPrompt} className="inline-flex items-center gap-1 text-primary2 hover:text-white">
              <ClipboardDocumentIcon className="h-4 w-4" />
              Copy
            </button>
          </div>
          <p className="mt-1 text-white/80 text-sm">{prompt}</p>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <button onClick={download} className="action-btn inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-white/10 border border-white/15 hover:bg-white/15">
            <ArrowDownTrayIcon className="h-5 w-5" /> Download
          </button>
          <button onClick={onNew} className="action-btn secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-white/10 border border-white/15 hover:bg-white/15">
            <PlusIcon className="h-5 w-5" /> New
          </button>
        </div>
      </div>

      <div className="relative">
        <img src={imageUrl} alt="Generated" className="w-full rounded-xl border border-white/15 shadow-soft fade-zoom-in" />
        <div className="absolute top-3 right-3 flex md:hidden gap-2">
          <button onClick={download} className="action-btn inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-black/40 border border-white/15">
            <ArrowDownTrayIcon className="h-5 w-5" />
          </button>
          <button onClick={onNew} className="action-btn secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-black/40 border border-white/15">
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
