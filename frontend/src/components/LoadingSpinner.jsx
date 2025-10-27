import React from 'react'

export default function LoadingSpinner({ size = 20 }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-white/30 border-t-accent"
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  )
}
