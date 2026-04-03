import { NextRequest, NextResponse } from 'next/server'
import { searchElevenLabsVoices } from '@/lib/vapi-client'

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get('search') || undefined
  const voices = await searchElevenLabsVoices(search)
  return NextResponse.json({ voices })
}
