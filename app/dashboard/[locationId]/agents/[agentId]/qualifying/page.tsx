'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface QualifyingQuestion {
  id: string
  question: string
  fieldKey: string
  required: boolean
  order: number
}

export default function QualifyingPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [questions, setQuestions] = useState<QualifyingQuestion[]>([])
  const [loading, setLoading] = useState(true)

  const [newQuestion, setNewQuestion] = useState('')
  const [newFieldKey, setNewFieldKey] = useState('')
  const [newRequired, setNewRequired] = useState(true)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}/qualifying-questions`)
      .then(r => r.json())
      .then(({ questions }) => setQuestions(questions ?? []))
      .finally(() => setLoading(false))
  }, [locationId, agentId])

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault()
    if (!newQuestion.trim() || !newFieldKey.trim()) return
    setAdding(true)
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/qualifying-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: newQuestion,
        fieldKey: newFieldKey,
        required: newRequired,
        order: questions.length,
      }),
    })
    const { question } = await res.json()
    setQuestions(prev => [...prev, question])
    setNewQuestion('')
    setNewFieldKey('')
    setNewRequired(true)
    setAdding(false)
  }

  async function toggleRequired(q: QualifyingQuestion) {
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/qualifying-questions/${q.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ required: !q.required }),
    })
    const { question } = await res.json()
    setQuestions(prev => prev.map(item => item.id === q.id ? question : item))
  }

  async function deleteQuestion(id: string) {
    await fetch(`/api/locations/${locationId}/agents/${agentId}/qualifying-questions/${id}`, { method: 'DELETE' })
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Qualifying Questions</h1>
        <p className="text-zinc-400 text-sm mb-8">Questions the agent must ask before taking goal actions.</p>

        {/* Existing questions */}
        {questions.length > 0 && (
          <div className="space-y-2 mb-8">
            {questions.sort((a, b) => a.order - b.order).map((q, idx) => (
              <div key={q.id} className="rounded-lg border border-zinc-800 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-zinc-600 w-4">{idx + 1}</span>
                      <span className="text-xs font-mono text-zinc-500 bg-zinc-800 rounded px-1.5 py-0.5">{q.fieldKey}</span>
                      <button
                        onClick={() => toggleRequired(q)}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${q.required ? 'bg-amber-900/40 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}
                      >
                        {q.required ? 'required' : 'optional'}
                      </button>
                    </div>
                    <p className="text-sm text-zinc-300">{q.question}</p>
                  </div>
                  <button
                    onClick={() => deleteQuestion(q.id)}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <div className="rounded-lg border border-zinc-800 p-4">
          <p className="text-sm font-medium text-zinc-300 mb-4">Add Question</p>
          <form onSubmit={addQuestion} className="space-y-3">
            <textarea
              value={newQuestion}
              onChange={e => setNewQuestion(e.target.value)}
              placeholder="What is your budget range?"
              required
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
            <input
              type="text"
              value={newFieldKey}
              onChange={e => setNewFieldKey(e.target.value)}
              placeholder="Field key (e.g. budget)"
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newRequired}
                onChange={e => setNewRequired(e.target.checked)}
              />
              <span className="text-sm text-zinc-300">Required</span>
            </label>
            <button
              type="submit"
              disabled={adding}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add Question'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
