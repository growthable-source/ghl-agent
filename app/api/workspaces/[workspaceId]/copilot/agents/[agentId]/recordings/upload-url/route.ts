/**
 * Client-direct upload token for Co-Pilot recordings.
 *
 * Recordings (screen videos especially) are far too big to POST
 * through a serverless function — Vercel caps a function REQUEST BODY
 * at ~4.5 MB, so the old formData upload silently failed for any real
 * video. This issues a short-lived token so the BROWSER uploads
 * straight to Vercel Blob (multipart, up to GBs); only the tiny token
 * exchange touches our function. The browser then calls the
 * recordings POST with just the resulting storageKey to register +
 * process it.
 *
 * Auth happens here in onBeforeGenerateToken (the browser sends its
 * session cookie), so a token is only minted for a workspace member
 * uploading to an agent they own.
 */

import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

const ALLOWED_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'application/pdf',
  'text/markdown',
  'text/plain',
]

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.copilotAgent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json()) as HandleUploadBody
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async pathname => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB
        // Namespace under the workspace+agent so a token can only write
        // where it should; pathname is supplied by the client upload().
        addRandomSuffix: false,
        tokenPayload: JSON.stringify({ workspaceId, agentId, pathname }),
      }),
      // onUploadCompleted fires via a Vercel webhook to the deployment;
      // it doesn't run locally, so registration is driven by the
      // browser calling the recordings POST instead. Left unset.
    })
    return NextResponse.json(json)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'upload token failed' }, { status: 400 })
  }
}
