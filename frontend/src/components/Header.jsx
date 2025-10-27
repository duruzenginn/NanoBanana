import React from 'react'

export default function Header() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xs bg-black/20 border-b border-white/10">
      <div className="mx-auto max-w-[800px] px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl drop-shadow">🍌</div>
          <div>
            <h1 className="text-lg md:text-xl font-semibold tracking-wide">DuruBanana</h1>
            <p className="text-xs md:text-sm text-white/70">Elegant AI Image Maker</p>
          </div>
        </div>
        <div className="hidden md:block text-white/70 text-sm">Gemini 2.5 Flash Image</div>
      </div>
    </header>
  )
}
