/**
 * OAuth Callback
 * URL: /api/auth/callback
 * 
 * This is your redirect URI registered in the Marketplace.
 * It receives the authorization code and exchanges it for tokens.
 * 
 * ⚠️  No provider names in this URL path — required by Marketplace TOS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { saveTokens } from '@/lib/token-store'
import { db } from '@/lib/db'
import { fetchInstallSnapshot } from '@/lib/leadconnector-install-fetcher'
import {
  cascadeAgentsToWorkspace as cascadeAgentsHelper,
  writeMarketplaceInstall as writeInstallHelper,
  workspaceSlugFromLocation,
  workspaceNameFromSnapshot,
} from '@/lib/oauth-install'
import { randomBytes } from 'node:crypto'
import type { OAuthTokenResponse } from '@/types'

export async function GET(req: NextRequest) {
  // Correlation id printed on every log line in this request and
  // surfaced on the failure redirect. Lets a customer report
  // "install failed with id ABC1234" and we can grep Vercel logs.
  const cid = randomBytes(4).toString('hex')
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  // Handle OAuth errors
  if (error) {
    console.error(`[OAuth ${cid}] Error from provider:`, error)
    return NextResponse.redirect(
      new URL(`/dashboard?error=${encodeURIComponent(error)}&cid=${cid}`, req.url)
    )
  }

  if (!code) {
    console.warn(`[OAuth ${cid}] Missing code in callback`)
    return NextResponse.redirect(new URL(`/dashboard?error=missing_code&cid=${cid}`, req.url))
  }

  try {
    // Exchange authorization code for tokens
    const params = new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID!,
      client_secret: process.env.OAUTH_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      user_type: 'Location',
      redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    })

    const tokenRes = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      console.error('[OAuth] Token exchange failed:', body)
      const msg = encodeURIComponent(`token_exchange_failed: ${body}`)
      return NextResponse.redirect(new URL(`/dashboard?error=${msg}`, req.url))
    }

    const tokenData: OAuthTokenResponse = await tokenRes.json()

    // Store using GHL locationId as key (or companyId for Agency tokens)
    const storeKey = tokenData.locationId ?? tokenData.companyId
    await saveTokens(storeKey, tokenData)

    console.log(`[OAuth] Token saved for ${tokenData.userType}: ${storeKey}`)

    // Diagnostic: log what scopes LeadConnector actually granted. When
    // a user reports "tags scope missing" but says they reconnected,
    // this line in Vercel logs is how we tell whether (a) the marketplace
    // listing config dropped the scope from the grant, or (b) the
    // listing's fine and the missing-scope error is from stale state on
    // an older Location row. Doesn't affect install flow either way.
    {
      const granted = Array.isArray(tokenData.scope)
        ? tokenData.scope.join(' ')
        : (tokenData.scope ?? '')
      console.log(`[OAuth] Granted scope for ${storeKey}: ${granted || '(empty)'}`)
      const importantScopes = [
        'locations.readonly',
        'locations/tags.readonly',
        'locations/tags.write',
        'locations/customFields.readonly',
        'users.readonly',
      ]
      const missing = importantScopes.filter(s => !granted.includes(s))
      if (missing.length > 0) {
        console.warn(`[OAuth] Granted scope is MISSING requested entries for ${storeKey}: ${missing.join(' ')}`)
      }
    }

    // Pull location + company + user metadata while we have a fresh
    // access token in hand. Used to (a) name the workspace from the
    // sub-account name instead of the bare "Workspace" placeholder,
    // and (b) snapshot the lead in MarketplaceInstall below. Failure
    // is non-fatal — install completes even if every API returns 403.
    const snapshot = await fetchInstallSnapshot({
      accessToken: tokenData.access_token,
      locationId: tokenData.locationId ?? null,
      companyId: tokenData.companyId ?? null,
      userId: tokenData.userId ?? null,
    }).catch(err => {
      console.warn('[OAuth] Install snapshot fetch failed:', err?.message)
      return null
    })

    // Decode the state param. Two contracts:
    //   1. Legacy: state is a bare workspaceId string. The connect
    //      route used this shape until we added returnTo support.
    //   2. New: state is base64url(JSON({ workspaceId, returnTo })).
    //      Callers (e.g. the agent-creation wizard) opt in by passing
    //      a returnTo query string to the connect route.
    // Try JSON first; on parse failure, treat the raw string as the
    // workspaceId. Marketplace installs (no state at all) fall through
    // to the no-state branch further down.
    const rawState = searchParams.get('state')
    let stateWorkspaceId: string | null = null
    let stateReturnTo: string | null = null
    let stateAgentId: string | null = null
    if (rawState) {
      try {
        const decoded = JSON.parse(Buffer.from(rawState, 'base64url').toString('utf8'))
        if (decoded && typeof decoded === 'object' && typeof decoded.workspaceId === 'string') {
          stateWorkspaceId = decoded.workspaceId
          if (
            typeof decoded.returnTo === 'string' &&
            decoded.returnTo.startsWith('/dashboard/') &&
            !decoded.returnTo.startsWith('//')
          ) {
            stateReturnTo = decoded.returnTo
          }
          if (typeof decoded.agentId === 'string') {
            stateAgentId = decoded.agentId
          }
        } else {
          stateWorkspaceId = rawState
        }
      } catch {
        stateWorkspaceId = rawState
      }
    }
    let workspaceId: string | null = null

    // Upsert the GHL Location record with token data.
    //
    // crmProvider is force-set to 'ghl' on (re)install so a previous
    // disconnect — which flips crmProvider to 'native' — doesn't leave
    // the row stuck after the user reconnects. Without this, the
    // integrations page's ghlConnected check (which requires
    // crmProvider === 'ghl') still reports "not connected" even though
    // OAuth completed and tokens are valid.
    const locationData = {
      companyId: tokenData.companyId ?? storeKey,
      userId: tokenData.userId ?? '',
      userType: tokenData.userType ?? 'Location',
      scope: Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : (tokenData.scope ?? ''),
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      refreshTokenId: tokenData.refreshTokenId ?? '',
      expiresAt: new Date(Date.now() + (tokenData.expires_in ?? 86400) * 1000),
      crmProvider: 'ghl',
      workspaceId: stateWorkspaceId || undefined,
    }

    await db.location.upsert({
      where: { id: storeKey },
      create: { id: storeKey, ...locationData },
      update: locationData,
    })

    // ── Cascade workspace binding to agents ─────────────────────────────
    // When a GHL Location moves between workspaces (re-install on a new
    // workspace), the Location row's workspaceId is rebound by the
    // upsert above, but agents previously created against this Location
    // stay tagged to the old workspace. Without this cascade, those
    // orphaned agents are still returned by findMatchingAgent (which
    // queries by locationId) and can fire on inbounds for the new
    // workspace — the "ghost agent" bug. Re-aligning Agent.workspaceId
    // to the Location's CURRENT workspaceId here prevents that.
    //
    // Closures over the local install context so both branches below
    // can fire-and-forget without passing the whole tokenData each time.
    const cascadeAgents = (targetWorkspaceId: string) =>
      cascadeAgentsHelper(storeKey, targetWorkspaceId)
    const writeInstall = (targetWorkspaceId: string, source: string) =>
      writeInstallHelper({
        workspaceId: targetWorkspaceId,
        source,
        snapshot,
        externalLocationId: tokenData.locationId ?? null,
        externalCompanyId: tokenData.companyId ?? null,
        externalUserId: tokenData.userId ?? null,
      })

    // ── Per-agent binding ───────────────────────────────────────────────
    // When the connect flow was started from an agent's CRM card, bind
    // the freshly connected sub-account to THAT agent. Connections belong
    // to agents, not the workspace — two agents in one workspace can
    // point at different sub-accounts. Guarded by workspace membership
    // (the agent must live in the state's workspace) so a tampered state
    // can't rebind someone else's agent.
    if (stateAgentId && stateWorkspaceId) {
      try {
        const bound = await db.agent.updateMany({
          where: { id: stateAgentId, workspaceId: stateWorkspaceId },
          data: { locationId: storeKey },
        })
        if (bound.count === 0) {
          console.warn(`[OAuth ${cid}] agent bind skipped — agent ${stateAgentId} not in workspace ${stateWorkspaceId}`)
        } else {
          console.log(`[OAuth ${cid}] bound agent ${stateAgentId} to location ${storeKey}`)
        }
      } catch (err: any) {
        // Binding failure shouldn't lose the OAuth grant — tokens are
        // saved; the user can re-pick the CRM from the agent card.
        console.warn(`[OAuth ${cid}] agent bind failed:`, err?.message)
      }
    }

    if (stateWorkspaceId) {
      await cascadeAgents(stateWorkspaceId)
      // Reconnect path. If this workspace was sitting on 'native' as its
      // primary CRM, flip it to 'ghl' now — connecting your first paid CRM
      // is the moment the integrations page should reorder around. If the
      // workspace already has a non-native primary set (e.g. 'hubspot'),
      // leave it alone; users running HubSpot as primary occasionally
      // reconnect GHL for one-off syncs and we shouldn't clobber that.
      try {
        await db.workspace.updateMany({
          where: { id: stateWorkspaceId, primaryCrmProvider: 'native' },
          data: { primaryCrmProvider: 'ghl' },
        })
      } catch (err: any) {
        // primaryCrmProvider column may not exist yet on un-migrated DBs.
        // Reconnect is more important than the auto-flip — log and move on.
        console.warn('[OAuth] primaryCrmProvider auto-update skipped:', err?.message)
      }
      // Reconnects still go through the registry — a customer who
      // disconnects and comes back is a high-signal re-engagement event
      // that's useful to see in the admin UI alongside first installs.
      await writeInstall(stateWorkspaceId, 'ghl_marketplace')
      // returnTo lets callers (notably the agent-creation wizard)
      // bring the user back to where they were instead of dumping
      // them on the workspace integrations page. Already path-validated
      // when state was decoded — must start with /dashboard/.
      const reconnectRedirect = stateReturnTo
        ?? `/dashboard/${stateWorkspaceId}/integrations?success=crm_connected`
      return NextResponse.redirect(new URL(reconnectRedirect, req.url))
    }

    // No workspace context — find existing workspace for this location, or create one
    const existingLocation = await db.location.findUnique({
      where: { id: storeKey },
      select: { workspaceId: true },
    })

    if (existingLocation?.workspaceId) {
      workspaceId = existingLocation.workspaceId
    } else {
      // Marketplace install branch: no stateWorkspaceId, no prior Location
      // → user arrived from the GHL marketplace listing. Stamp the new
      // workspace with installSource so the integrations page surfaces
      // LeadConnector as the recommended option and tucks the others away.
      // Slug + display name come from lib/oauth-install helpers so
      // the heuristics live in one place and can be unit-tested.
      const slug = workspaceSlugFromLocation(storeKey)
      const { name: workspaceName, domain: workspaceDomain } =
        workspaceNameFromSnapshot(snapshot)

      let workspace
      try {
        workspace = await db.workspace.create({
          data: {
            name: workspaceName,
            slug,
            domain: workspaceDomain,
            installSource: 'ghl_marketplace',
            primaryCrmProvider: 'ghl',
            locations: { connect: { id: storeKey } },
          },
        })
      } catch (err: any) {
        // Fallback for un-migrated DBs missing the new columns. The
        // install still completes; the workspace just won't have the
        // marketplace attribution recorded.
        console.warn('[OAuth] Workspace create without install fields:', err?.message)
        workspace = await db.workspace.create({
          data: {
            name: workspaceName,
            slug,
            domain: workspaceDomain,
            locations: { connect: { id: storeKey } },
          },
        })
      }
      workspaceId = workspace.id
    }

    await cascadeAgents(workspaceId)
    await writeInstall(workspaceId, 'ghl_marketplace')

    // New installs go to onboarding, reinstalls go to dashboard
    const agentCount = await db.agent.count({ where: { workspaceId } })
    const redirectPath = agentCount === 0
      ? `/dashboard/${workspaceId}/onboarding`
      : `/dashboard/${workspaceId}`
    return NextResponse.redirect(new URL(redirectPath, req.url))
  } catch (err: any) {
    console.error(`[OAuth ${cid}] Unexpected error:`, err?.message, err?.stack)
    return NextResponse.redirect(new URL(`/dashboard?error=unexpected&cid=${cid}`, req.url))
  }
}
