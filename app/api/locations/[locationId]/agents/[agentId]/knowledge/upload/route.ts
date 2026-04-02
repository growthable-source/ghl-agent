import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chunkText, estimateTokens } from '@/lib/chunker'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ locationId: string; agentId: string }> }
) {
  const { agentId } = await params

  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const maxSize = 5 * 1024 * 1024 // 5MB
  if (file.size > maxSize) {
    return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
  }

  const fileName = file.name
  const ext = fileName.split('.').pop()?.toLowerCase()

  let text = ''

  if (ext === 'txt' || ext === 'md') {
    text = await file.text()
  } else if (ext === 'pdf') {
    const arrayBuffer = await file.arrayBuffer()
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) })
    const result = await parser.getText()
    text = result.text
  } else {
    return NextResponse.json({ error: 'Unsupported file type. Use .pdf, .txt, or .md' }, { status: 400 })
  }

  if (!text || text.trim().length < 50) {
    return NextResponse.json({ error: 'File has no readable content' }, { status: 400 })
  }

  const chunks = chunkText(text.trim())
  const baseName = fileName.replace(/\.[^.]+$/, '')

  const entries = await Promise.all(
    chunks.map((chunk, i) =>
      db.knowledgeEntry.create({
        data: {
          agentId,
          title: chunks.length === 1 ? baseName : `${baseName} (${i + 1}/${chunks.length})`,
          content: chunk,
          source: 'file',
          tokenEstimate: estimateTokens(chunk),
        },
      })
    )
  )

  return NextResponse.json({
    success: true,
    chunks: entries.length,
    fileName,
    totalTokens: entries.reduce((sum, e) => sum + e.tokenEstimate, 0),
  })
}
