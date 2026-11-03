'use client'

import { useState } from 'react'

/** Read-only value with a Copy button (falls back to selecting the text). */
export default function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(input: HTMLInputElement | null) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      input?.select()
    }
  }

  return (
    <div className="flex gap-2 items-center">
      <input
        readOnly
        value={value}
        onFocus={e => e.currentTarget.select()}
        className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-200"
      />
      <button
        type="button"
        onClick={e => void copy(e.currentTarget.previousElementSibling as HTMLInputElement | null)}
        className="text-xs font-medium border rounded-lg px-3 py-1.5 text-zinc-200 border-zinc-700 hover:bg-zinc-800"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
