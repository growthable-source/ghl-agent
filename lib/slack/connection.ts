import { db } from '@/lib/db'
import { encryptSecret, decryptSecret } from '@/lib/secrets'

export async function getSlackConnection(workspaceId: string) {
  return db.slackConnection.findUnique({ where: { workspaceId } })
}

export async function getDecryptedBotToken(workspaceId: string): Promise<string | null> {
  const conn = await db.slackConnection.findUnique({ where: { workspaceId } })
  if (!conn) return null
  return decryptSecret(conn.botToken)
}

export async function upsertSlackConnection(input: {
  workspaceId: string
  teamId: string
  teamName?: string
  botToken: string // plaintext; encrypted here
  botUserId: string
  appId?: string
  scopes?: string
  installedByUserId?: string
}) {
  const botToken = encryptSecret(input.botToken)
  return db.slackConnection.upsert({
    where: { workspaceId: input.workspaceId },
    create: {
      workspaceId: input.workspaceId,
      teamId: input.teamId,
      teamName: input.teamName,
      botToken,
      botUserId: input.botUserId,
      appId: input.appId,
      scopes: input.scopes,
      installedByUserId: input.installedByUserId,
    },
    update: {
      teamId: input.teamId,
      teamName: input.teamName,
      botToken,
      botUserId: input.botUserId,
      appId: input.appId,
      scopes: input.scopes,
      installedByUserId: input.installedByUserId,
    },
  })
}

export async function setDefaultChannel(workspaceId: string, channelId: string, channelName: string) {
  return db.slackConnection.update({
    where: { workspaceId },
    data: { defaultChannelId: channelId, defaultChannelName: channelName },
  })
}

export async function deleteSlackConnection(workspaceId: string) {
  await db.slackConnection.deleteMany({ where: { workspaceId } })
}

/** Resolve a Slack team back to the workspace that installed it (inbound events). */
export async function getConnectionByTeam(teamId: string) {
  return db.slackConnection.findFirst({ where: { teamId } })
}
