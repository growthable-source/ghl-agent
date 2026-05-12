/**
 * Shopify Admin API adapter.
 *
 * GraphQL-only (REST is in deprecation tracks at Shopify). All requests
 * go through `gql<T>()`, which:
 *   - injects the per-shop access token via X-Shopify-Access-Token
 *   - throws a structured error on non-2xx or on a userErrors response
 *   - has a single retry on 429 / 5xx with a small fixed backoff
 *     (Shopify rate-limits via leaky-bucket; aggressive backoff isn't
 *     warranted for the tool-call traffic shape we have here)
 *
 * One adapter instance is bound to one shop+token pair. Construct via
 * the workspaceId-keyed factory in ./factory.ts — don't reach for the
 * constructor directly except in tests.
 *
 * Method philosophy: return PLAIN, AGENT-FRIENDLY shapes (flat objects
 * with the fields the LLM cares about), not raw Shopify edges/nodes.
 * The dispatcher in lib/agent/execute-tool.ts will JSON.stringify the
 * return value and hand it to the model; the leaner the shape, the
 * less prompt-budget the model burns parsing it.
 */

const API_VERSION = '2025-01'

export interface ShopifyAdapterConfig {
  shop: string // canonical *.myshopify.com domain
  accessToken: string
}

export interface ProductHit {
  id: string
  title: string
  handle: string
  productType: string
  vendor: string
  tags: string[]
  description: string
  priceRange: { min: string; max: string; currency: string }
  totalInventory: number
  variants: VariantSummary[]
}

export interface VariantSummary {
  id: string
  title: string
  sku: string | null
  price: string
  inventoryQuantity: number
  availableForSale: boolean
}

export interface InventoryByLocation {
  locationName: string
  available: number
}

export interface InventorySnapshot {
  variantId: string
  variantTitle: string
  sku: string | null
  totalAvailable: number
  availableForSale: boolean
  byLocation: InventoryByLocation[]
}

export interface CustomerProfile {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  numberOfOrders: number
  lifetimeSpend: { amount: string; currency: string } | null
  tags: string[]
  recentOrders: CustomerOrderSummary[]
}

export interface CustomerOrderSummary {
  id: string
  name: string // e.g. "#1042"
  processedAt: string | null
  total: { amount: string; currency: string }
  fulfillmentStatus: string | null
  lineItems: { title: string; quantity: number }[]
}

export interface OrderDetail {
  id: string
  name: string
  processedAt: string | null
  fulfillmentStatus: string | null
  financialStatus: string | null
  total: { amount: string; currency: string }
  customer: { name: string | null; email: string | null } | null
  fulfillments: { status: string; tracking: { number: string | null; url: string | null; company: string | null }[] }[]
  lineItems: { title: string; sku: string | null; quantity: number }[]
}

export class ShopifyAdapter {
  constructor(private readonly cfg: ShopifyAdapterConfig) {}

  /** Search products by free text. Maps to the agent's "do you have X?" question. */
  async searchProducts(query: string, limit = 10): Promise<ProductHit[]> {
    const data = await this.gql<{ products: { edges: { node: RawProduct }[] } }>(
      PRODUCT_SEARCH_QUERY,
      { query, first: clamp(limit, 1, 25) },
    )
    return data.products.edges.map(e => mapProduct(e.node))
  }

  /**
   * Inventory snapshot for a single variant. Variant ID format is the
   * full Shopify GID (e.g. "gid://shopify/ProductVariant/12345"). The
   * agent will typically have called searchProducts first and is
   * passing back a variant id we returned.
   */
  async getInventoryForVariant(variantId: string): Promise<InventorySnapshot | null> {
    const data = await this.gql<{ productVariant: RawVariantWithInventory | null }>(
      VARIANT_INVENTORY_QUERY,
      { id: variantId },
    )
    if (!data.productVariant) return null
    return mapInventory(data.productVariant)
  }

  /**
   * Lookup a customer by email OR phone. Returns the FIRST match
   * because Shopify allows multiple customers with the same contact
   * info and the agent only needs the most relevant one. Returns null
   * when nothing matches — the agent should treat that as "new
   * customer" and continue without fabricating history.
   */
  async findCustomer(args: { email?: string | null; phone?: string | null }): Promise<CustomerProfile | null> {
    const parts: string[] = []
    if (args.email) parts.push(`email:${quote(args.email)}`)
    if (args.phone) parts.push(`phone:${quote(args.phone)}`)
    if (parts.length === 0) return null
    const q = parts.join(' OR ')

    const data = await this.gql<{ customers: { edges: { node: RawCustomer }[] } }>(
      CUSTOMER_SEARCH_QUERY,
      { query: q },
    )
    const first = data.customers.edges[0]?.node
    return first ? mapCustomer(first) : null
  }

  /**
   * Lookup an order by its merchant-visible name (e.g. "#1042" or
   * "1042"). Includes fulfillment + tracking — the most common reason
   * a customer DMs after purchase.
   */
  async getOrderByName(orderName: string): Promise<OrderDetail | null> {
    const normalised = orderName.trim().replace(/^#?/, '#')
    const data = await this.gql<{ orders: { edges: { node: RawOrder }[] } }>(
      ORDER_BY_NAME_QUERY,
      { query: `name:${quote(normalised)}` },
    )
    const first = data.orders.edges[0]?.node
    return first ? mapOrder(first) : null
  }

  // ─── Transport ─────────────────────────────────────────────────────
  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const url = `https://${this.cfg.shop}/admin/api/${API_VERSION}/graphql.json`
    const body = JSON.stringify({ query, variables })

    let attempt = 0
    let lastErr: unknown
    while (attempt < 2) {
      attempt += 1
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.cfg.accessToken,
          },
          body,
        })
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`shopify gql ${res.status}: ${(await res.text()).slice(0, 300)}`)
          // Tiny fixed backoff before the one retry. We're not chasing
          // throughput here; we just want to ride out the cliff edge
          // of a single rate-limit bucket refill.
          await new Promise(r => setTimeout(r, 500))
          continue
        }
        if (!res.ok) {
          throw new Error(`shopify gql ${res.status}: ${(await res.text()).slice(0, 300)}`)
        }
        const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
        if (json.errors?.length) {
          // GraphQL errors are NOT retriable — they're schema/validation
          // failures, not transient. Surface them as-is for debuggability.
          throw new Error(`shopify gql errors: ${json.errors.map(e => e.message).join('; ')}`)
        }
        if (!json.data) throw new Error('shopify gql: empty response')
        return json.data
      } catch (err) {
        lastErr = err
        if (attempt >= 2) throw err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('shopify gql failed')
  }
}

// ─── Quoting / clamping helpers ─────────────────────────────────────
// Shopify's search query parser accepts double-quoted strings; quoting
// is the simplest way to handle values containing spaces/special chars.
// Backslash-escape any embedded quote.
function quote(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(n)))
}

// ─── Raw response shapes (private) ──────────────────────────────────

interface RawMoney { amount: string; currencyCode: string }

interface RawProduct {
  id: string
  title: string
  handle: string
  productType: string
  vendor: string
  tags: string[]
  description: string
  priceRangeV2: { minVariantPrice: RawMoney; maxVariantPrice: RawMoney }
  totalInventory: number | null
  variants: { edges: { node: RawVariant }[] }
}

interface RawVariant {
  id: string
  title: string
  sku: string | null
  price: string
  inventoryQuantity: number | null
  availableForSale: boolean
}

interface RawVariantWithInventory extends RawVariant {
  inventoryItem: {
    inventoryLevels: {
      edges: {
        node: {
          location: { name: string }
          quantities: { name: string; quantity: number }[]
        }
      }[]
    }
  } | null
}

interface RawCustomer {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  numberOfOrders: string // Shopify returns this as a stringified int
  amountSpent: RawMoney | null
  tags: string[]
  orders: { edges: { node: RawCustomerOrder }[] }
}

interface RawCustomerOrder {
  id: string
  name: string
  processedAt: string | null
  totalPriceSet: { shopMoney: RawMoney }
  displayFulfillmentStatus: string | null
  lineItems: { edges: { node: { title: string; quantity: number } }[] }
}

interface RawOrder {
  id: string
  name: string
  processedAt: string | null
  displayFulfillmentStatus: string | null
  displayFinancialStatus: string | null
  totalPriceSet: { shopMoney: RawMoney }
  customer: { firstName: string | null; lastName: string | null; email: string | null } | null
  fulfillments: { status: string; trackingInfo: { number: string | null; url: string | null; company: string | null }[] }[]
  lineItems: { edges: { node: { title: string; sku: string | null; quantity: number } }[] }
}

// ─── Mappers (raw → agent-friendly) ─────────────────────────────────

function mapProduct(n: RawProduct): ProductHit {
  return {
    id: n.id,
    title: n.title,
    handle: n.handle,
    productType: n.productType,
    vendor: n.vendor,
    tags: n.tags,
    description: n.description,
    priceRange: {
      min: n.priceRangeV2.minVariantPrice.amount,
      max: n.priceRangeV2.maxVariantPrice.amount,
      currency: n.priceRangeV2.minVariantPrice.currencyCode,
    },
    totalInventory: n.totalInventory ?? 0,
    variants: n.variants.edges.map(e => mapVariantSummary(e.node)),
  }
}

function mapVariantSummary(v: RawVariant): VariantSummary {
  return {
    id: v.id,
    title: v.title,
    sku: v.sku,
    price: v.price,
    inventoryQuantity: v.inventoryQuantity ?? 0,
    availableForSale: v.availableForSale,
  }
}

function mapInventory(v: RawVariantWithInventory): InventorySnapshot {
  const byLocation: InventoryByLocation[] = (v.inventoryItem?.inventoryLevels.edges ?? []).map(e => ({
    locationName: e.node.location.name,
    available: e.node.quantities.find(q => q.name === 'available')?.quantity ?? 0,
  }))
  return {
    variantId: v.id,
    variantTitle: v.title,
    sku: v.sku,
    totalAvailable: v.inventoryQuantity ?? 0,
    availableForSale: v.availableForSale,
    byLocation,
  }
}

function mapCustomer(c: RawCustomer): CustomerProfile {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    numberOfOrders: parseInt(c.numberOfOrders, 10) || 0,
    lifetimeSpend: c.amountSpent
      ? { amount: c.amountSpent.amount, currency: c.amountSpent.currencyCode }
      : null,
    tags: c.tags,
    recentOrders: c.orders.edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
      processedAt: e.node.processedAt,
      total: {
        amount: e.node.totalPriceSet.shopMoney.amount,
        currency: e.node.totalPriceSet.shopMoney.currencyCode,
      },
      fulfillmentStatus: e.node.displayFulfillmentStatus,
      lineItems: e.node.lineItems.edges.map(le => ({ title: le.node.title, quantity: le.node.quantity })),
    })),
  }
}

function mapOrder(o: RawOrder): OrderDetail {
  return {
    id: o.id,
    name: o.name,
    processedAt: o.processedAt,
    fulfillmentStatus: o.displayFulfillmentStatus,
    financialStatus: o.displayFinancialStatus,
    total: {
      amount: o.totalPriceSet.shopMoney.amount,
      currency: o.totalPriceSet.shopMoney.currencyCode,
    },
    customer: o.customer
      ? {
          name: [o.customer.firstName, o.customer.lastName].filter(Boolean).join(' ') || null,
          email: o.customer.email,
        }
      : null,
    fulfillments: o.fulfillments.map(f => ({
      status: f.status,
      tracking: f.trackingInfo.map(t => ({ number: t.number, url: t.url, company: t.company })),
    })),
    lineItems: o.lineItems.edges.map(e => ({
      title: e.node.title,
      sku: e.node.sku,
      quantity: e.node.quantity,
    })),
  }
}

// ─── GraphQL documents ──────────────────────────────────────────────

const PRODUCT_SEARCH_QUERY = `
  query Products($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          productType
          vendor
          tags
          description
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          totalInventory
          variants(first: 10) {
            edges {
              node {
                id
                title
                sku
                price
                inventoryQuantity
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`

const VARIANT_INVENTORY_QUERY = `
  query Variant($id: ID!) {
    productVariant(id: $id) {
      id
      title
      sku
      price
      inventoryQuantity
      availableForSale
      inventoryItem {
        inventoryLevels(first: 25) {
          edges {
            node {
              location { name }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
`

const CUSTOMER_SEARCH_QUERY = `
  query Customers($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          numberOfOrders
          amountSpent { amount currencyCode }
          tags
          orders(first: 5, sortKey: PROCESSED_AT, reverse: true) {
            edges {
              node {
                id
                name
                processedAt
                totalPriceSet { shopMoney { amount currencyCode } }
                displayFulfillmentStatus
                lineItems(first: 5) {
                  edges { node { title quantity } }
                }
              }
            }
          }
        }
      }
    }
  }
`

const ORDER_BY_NAME_QUERY = `
  query Orders($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          processedAt
          displayFulfillmentStatus
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName email }
          fulfillments {
            status
            trackingInfo { number url company }
          }
          lineItems(first: 10) {
            edges { node { title sku quantity } }
          }
        }
      }
    }
  }
`
