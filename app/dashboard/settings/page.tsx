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
  { value: 'dark', label: 'Dark', desc: 'Dark backgrounds with light text' },
  { value: 'light', label: 'Light', desc: 'Light backgrounds with dark text' },
  { value: 'system', label: 'System', desc: 'Match your operating system preference' },
] as const

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
          if (user.theme) setTheme(user.theme)
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
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleThemeChange(opt.value)}
              className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${
                theme === opt.value
                  ? 'border-white bg-zinc-900'
                  : 'border-zinc-800 hover:border-zinc-600'
              }`}
            >
              {/* Theme preview */}
              <div className={`w-full h-16 rounded-md border overflow-hidden ${
                opt.value === 'dark'
                  ? 'bg-zinc-950 border-zinc-700'
                  : opt.value === 'light'
                  ? 'bg-white border-zinc-300'
                  : 'bg-gradient-to-r from-zinc-950 to-white border-zinc-500'
              }`}>
                <div className="flex h-full">
                  {/* Mini sidebar */}
                  <div className={`w-1/4 h-full ${
                    opt.value === 'dark' ? 'bg-black' : opt.value === 'light' ? 'bg-zinc-100' : 'bg-gradient-to-b from-black to-zinc-100'
                  }`}>
                    <div className={`mx-1 mt-2 h-1 rounded-full ${opt.value === 'light' ? 'bg-zinc-300' : 'bg-zinc-700'}`} />
                    <div className={`mx-1 mt-1 h-1 rounded-full ${opt.value === 'light' ? 'bg-zinc-300' : 'bg-zinc-700'}`} />
                    <div className={`mx-1 mt-1 h-1 rounded-full ${opt.value === 'light' ? 'bg-zinc-300' : 'bg-zinc-700'}`} />
                  </div>
                  {/* Mini content */}
                  <div className="flex-1 p-1.5">
                    <div className={`h-1.5 w-3/4 rounded-full mb-1 ${opt.value === 'light' ? 'bg-zinc-200' : 'bg-zinc-800'}`} />
                    <div className={`h-1 w-1/2 rounded-full ${opt.value === 'light' ? 'bg-zinc-200' : 'bg-zinc-800'}`} />
                  </div>
                </div>
              </div>
              <div className="text-center">
                <span className="text-sm font-medium text-zinc-200">{opt.label}</span>
                <p className="text-xs text-zinc-500 mt-0.5">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
