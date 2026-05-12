/**
 * Shopify webhook subscription helpers.
 *
 * After a successful OAuth install we register the webhooks our app
 * needs. Idempotent — Shopify dedupes subscriptions by (topic,
 * callbackUrl), so re-running on token rotation or re-install is a
 * no-op for already-registered topics.
 *
 * All HMAC verification on inbound webhook deliveries uses the app's
 * client secret (see lib/commerce/shopify/hmac.ts).
 */

const WEBHOOK_API_VERSION = '2025-01'

export interface WebhookTopicSpec {
  /**
   * Shopify topic name as expected by webhookSubscriptionCreate's
   * `topic` arg. e.g. INVENTORY_LEVELS_UPDATE, APP_UNINSTALLED.
   * Underscores, uppercase.
   */
  topic: string
  /** Path on our app to receive the POST. Prepended with APP_URL. */
  path: string
}

const TOPICS: WebhookTopicSpec[] = [
  { topic: 'INVENTORY_LEVELS_UPDATE', path: '/api/webhooks/shopify/inventory-levels-update' },
  { topic: 'APP_UNINSTALLED', path: '/api/webhooks/shopify/app-uninstalled' },
]

/**
 * Register all required webhook subscriptions for a freshly-installed
 * shop. Best-effort: a single topic failure logs + continues, because
 * partial registration is still useful (e.g. uninstall registered
 * even if inventory failed).
 *
 * Idempotent. Shopify returns `userErrors: [{ message: "for this topic
 * and address already exists" }]` for duplicates, which we treat as a
 * successful no-op.
 */
export async function registerWebhooks(shop: string, accessToken: string): Promise<void> {
  const appUrl = (process.env.APP_URL || 'https://app.voxility.ai').replace(/\/+$/, '')

  for (const t of TOPICS) {
    const callbackUrl = `${appUrl}${t.path}`
    try {
      const res = await fetch(`https://${shop}/admin/api/${WEBHOOK_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query: WEBHOOK_SUBSCRIPTION_CREATE,
          variables: {
            topic: t.topic,
            webhookSubscription: {
              callbackUrl,
              format: 'JSON',
            },
          },
        }),
      })
      if (!res.ok) {
        console.error(`[Shopify webhooks] ${t.topic} register HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
        continue
      }
      const json = (await res.json()) as {
        data?: {
          webhookSubscriptionCreate?: {
            userErrors: { field: string[]; message: string }[]
            webhookSubscription: { id: string } | null
          }
        }
      }
      const result = json.data?.webhookSubscriptionCreate
      if (!result) {
        console.error(`[Shopify webhooks] ${t.topic} register: malformed response`)
        continue
      }
      const errs = result.userErrors ?? []
      const alreadyExists = errs.some(e => /already exists/i.test(e.message))
      if (errs.length > 0 && !alreadyExists) {
        console.error(`[Shopify webhooks] ${t.topic} register userErrors: ${errs.map(e => e.message).join('; ')}`)
        continue
      }
      console.log(`[Shopify webhooks] ${t.topic} ${alreadyExists ? 'already registered' : 'registered'} for ${shop}`)
    } catch (err) {
      console.error(`[Shopify webhooks] ${t.topic} register threw:`, err)
    }
  }
}

const WEBHOOK_SUBSCRIPTION_CREATE = `
  mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`
