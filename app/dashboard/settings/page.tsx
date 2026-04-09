'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

interface UserSettings {
  id: string
  name: string | null
  email: string | null
  image: string | null
  theme: string
}

const THEME_OPTIONS = [
  {
    value: 'midnight',
    label: 'Midnight',
    desc: 'Deep blue-gray',
    sidebar: '#080a10',
    content: '#0b0e14',
    surface: '#11151e',
    border: '#353b4a',
    bar: '#9ba2b2',
    barMuted: '#252a37',
  },
  {
    value: 'sunset',
    label: 'Sunset',
    desc: 'Warm amber tones',
    sidebar: '#14100e',
    content: '#1a1412',
    surface: '#221c18',
    border: '#4a3e36',
    bar: '#b5a89d',
    barMuted: '#382e28',
  },
  {
    value: 'dim',
    label: 'Dim',
    desc: 'Mid-tone, easy on eyes',
    sidebar: '#1c2128',
    content: '#22272e',
    surface: '#2d333b',
    border: '#4d5566',
    bar: '#9aabb8',
    barMuted: '#3d4450',
  },
  {
    value: 'soft-light',
    label: 'Soft Light',
    desc: 'Warm off-white',
    sidebar: '#f1f0ec',
    content: '#f8f7f4',
    surface: '#faf9f7',
    border: '#cdc9c0',
    bar: '#78716c',
    barMuted: '#e5e2dc',
  },
  {
    value: 'system',
    label: 'System',
    desc: 'Match your OS',
    sidebar: '',
    content: '',
    surface: '',
    border: '',
    bar: '',
    barMuted: '',
  },
] as const

function ThemePreview({ opt, isActive }: { opt: typeof THEME_OPTIONS[number]; isActive: boolean }) {
  if (opt.value === 'system') {
    // Split preview: left = midnight, right = soft light
    return (
      <div className={`w-full h-20 rounded-lg border overflow-hidden ${isActive ? 'border-2' : ''}`}
           style={{ borderColor: isActive ? 'var(--text-primary)' : 'var(--border)' }}>
        <div className="flex h-full">
          {/* Dark half */}
          <div className="w-1/2 flex">
            <div className="w-1/3 h-full" style={{ background: '#080a10' }}>
              <div className="mx-1 mt-3 h-1 rounded-full" style={{ background: '#252a37' }} />
              <div className="mx-1 mt-1 h-1 rounded-full" style={{ background: '#252a37' }} />
              <div className="mx-1 mt-1 h-1 rounded-full" style={{ background: '#252a37' }} />
            </div>
            <div className="flex-1 p-2" style={{ background: '#0b0e14' }}>
              <div className="h-1.5 w-3/4 rounded-full mb-1.5" style={{ background: '#252a37' }} />
              <div className="h-1 w-1/2 rounded-full" style={{ background: '#252a37' }} />
            </div>
          </div>
          {/* Light half */}
          <div className="w-1/2 flex">
            <div className="w-1/3 h-full" style={{ background: '#f1f0ec' }}>
              <div className="mx-1 mt-3 h-1 rounded-full" style={{ background: '#e5e2dc' }} />
              <div className="mx-1 mt-1 h-1 rounded-full" style={{ background: '#e5e2dc' }} />
              <div className="mx-1 mt-1 h-1 rounded-full" style={{ background: '#e5e2dc' }} />
            </div>
            <div className="flex-1 p-2" style={{ background: '#f8f7f4' }}>
              <div className="h-1.5 w-3/4 rounded-full mb-1.5" style={{ background: '#e5e2dc' }} />
              <div className="h-1 w-1/2 rounded-full" style={{ background: '#e5e2dc' }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`w-full h-20 rounded-lg border overflow-hidden ${isActive ? 'border-2' : ''}`}
         style={{ borderColor: isActive ? 'var(--text-primary)' : 'var(--border)' }}>
      <div className="flex h-full">
        {/* Mini sidebar */}
        <div className="w-1/4 h-full" style={{ background: opt.sidebar, borderRight: `1px solid ${opt.border}` }}>
          <div className="mx-1.5 mt-3 h-1 rounded-full" style={{ background: opt.barMuted }} />
          <div className="mx-1.5 mt-1 h-1 rounded-full" style={{ background: opt.barMuted }} />
          <div className="mx-1.5 mt-1 h-1 rounded-full" style={{ background: opt.barMuted }} />
          <div className="mx-1.5 mt-1 h-1 rounded-full" style={{ background: opt.barMuted }} />
        </div>
        {/* Mini content */}
        <div className="flex-1 p-2.5" style={{ background: opt.content }}>
          <div className="h-2 w-2/3 rounded-full mb-2" style={{ background: opt.bar, opacity: 0.6 }} />
          <div className="rounded-md p-1.5" style={{ background: opt.surface, border: `1px solid ${opt.border}` }}>
            <div className="h-1 w-full rounded-full mb-1" style={{ background: opt.barMuted }} />
            <div className="h-1 w-3/4 rounded-full" style={{ background: opt.barMuted }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [user, setUser] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/user/settings')
      .then(r => r.json())
      .then(({ user }) => {
        if (user) {
          setUser(user)
          setName(user.name ?? '')
          // Backward compat: map legacy theme names
          const mapped = user.theme === 'dark' ? 'midnight' : user.theme === 'light' ? 'soft-light' : user.theme
          if (mapped) setTheme(mapped)
        }
      })
      .finally(() => setLoading(false))
  }, [setTheme])

  async function handleThemeChange(value: string) {
    setTheme(value)
    await fetch('/api/user/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: value }),
    })
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    const res = await fetch('/api/user/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const { user: updated } = await res.json()
    if (updated) setUser(updated)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-zinc-500 text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold mb-1">Settings</h1>
        <p className="text-zinc-400 text-sm">Manage your profile and preferences.</p>
      </div>

      {/* Profile */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 mb-6">
        <h2 className="text-sm font-medium text-zinc-200 mb-4">Profile</h2>
        <form onSubmit={handleSaveName} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
            <p className="text-sm text-zinc-300">{user?.email ?? '—'}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Display name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-white text-black font-medium text-sm px-4 h-9 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {saved && <span className="text-xs text-emerald-400">Saved</span>}
          </div>
        </form>
      </div>

      {/* Theme */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-sm font-medium text-zinc-200 mb-1">Appearance</h2>
        <p className="text-xs text-zinc-500 mb-4">Choose how the dashboard looks to you.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleThemeChange(opt.value)}
              className="flex flex-col gap-2 text-left group"
            >
              <ThemePreview opt={opt} isActive={theme === opt.value} />
              <div className="px-0.5">
                <span className={`text-sm font-medium ${theme === opt.value ? 'text-zinc-200' : 'text-zinc-400 group-hover:text-zinc-300'} transition-colors`}>
                  {opt.label}
                </span>
                <p className="text-xs text-zinc-500 mt-0.5">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
