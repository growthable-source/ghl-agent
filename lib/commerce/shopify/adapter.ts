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
  /**
   * Featured image (Shopify CDN URL). Null when the product has no
   * images uploaded. The agent uses this for rich card rendering in
   * channels that support it (widget, eventually Meta Generic Template).
   */
  featuredImageUrl: string | null
  /**
   * Canonical storefront URL. We construct from the shop's myshopify.com
   * domain rather than fetching `onlineStoreUrl` per-product — same
   * destination (Shopify redirects to the merchant's primary domain if
   * one is configured) and skips an extra GraphQL field per request.
   */
  onlineStoreUrl: string
}

/**
 * Minimal payload for rendering a rich product card in the widget.
 * Kept narrow so the JSON we stash in WidgetMessage.content stays small
 * and the widget renderer doesn't have to know about Shopify's full
 * product schema.
 */
export interface ProductCard {
  id: string
  title: string
  handle: string
  price: { amount: string; currency: string }
  imageUrl: string | null
  url: string
}

export interface DraftOrderLineItemInput {
  variantId: string
  quantity: number
}

export interface DraftOrderResult {
  id: string
  /**
   * The hosted Shopify checkout URL. Customer pays via Shopify's
   * standard checkout — no PCI exposure on our side. Single-use; once
   * paid the draft converts to a real order.
   */
  invoiceUrl: string | null
  totalPrice: string
  currencyCode: string
}

export interface DiscountCodeInput {
  /** Customer-facing code, e.g. "HELLO10". Must be unique on the shop. */
  code: string
  /**
   * Discount kind. 'percentage' uses `value` as a percent (e.g. 10 =
   * 10% off); 'fixed_amount' as a money amount in the shop's currency.
   */
  type: 'percentage' | 'fixed_amount'
  value: number
  /** Cap total redemptions. Default 1 — single-use save-the-sale code. */
  usageLimit?: number
  /** Hours from now until the code expires. Default 72h. */
  expiresInHours?: number
}

export interface DiscountCodeResult {
  code: string
  expiresAt: string
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
    return data.products.edges.map(e => mapProduct(e.node, this.cfg.shop))
  }

  /**
   * Fetch the minimal card payload for a single product by GID. Used by
   * the widget adapter when expanding `<productCard>` markers in agent
   * replies — re-fetching is cheap and avoids stale data if the agent
   * is referencing a search result from a while ago.
   *
   * Returns null when the product doesn't exist (or is unpublished /
   * deleted) — caller drops the marker rather than rendering a broken
   * card.
   */
  async getProductCardByGid(productId: string): Promise<ProductCard | null> {
    const data = await this.gql<{ product: RawProductCard | null }>(
      PRODUCT_CARD_QUERY,
      { id: productId },
    )
    if (!data.product) return null
    return mapProductCard(data.product, this.cfg.shop)
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
   * Create a Shopify draft order and return its hosted checkout URL.
   * The customer clicks the URL and lands on Shopify's checkout with
   * the items pre-loaded — no PCI exposure on our side.
   *
   * Caller responsibility: validate variantIds came from a recent
   * searchProducts call rather than the agent's imagination. The
   * mutation will reject unknown variants but the error message
   * isn't agent-friendly.
   */
  async createDraftOrder(args: {
    lineItems: DraftOrderLineItemInput[]
    customerEmail?: string | null
    discountCode?: string | null
    note?: string | null
  }): Promise<DraftOrderResult> {
    const input: Record<string, unknown> = {
      lineItems: args.lineItems.map(li => ({
        variantId: li.variantId,
        quantity: Math.max(1, Math.floor(li.quantity)),
      })),
    }
    if (args.customerEmail) input.email = args.customerEmail
    if (args.note) input.note = args.note
    if (args.discountCode) {
      // Apply at the draft-order level. Shopify validates the code is
      // real + applicable; invalid codes throw via userErrors.
      input.appliedDiscount = { description: args.discountCode, title: args.discountCode, value: 0, valueType: 'PERCENTAGE' }
    }

    const data = await this.gql<{
      draftOrderCreate: {
        draftOrder: {
          id: string
          invoiceUrl: string | null
          totalPriceSet: { shopMoney: RawMoney }
        } | null
        userErrors: { field: string[]; message: string }[]
      }
    }>(DRAFT_ORDER_CREATE_MUTATION, { input })

    const errs = data.draftOrderCreate.userErrors
    if (errs && errs.length > 0) {
      throw new Error(`shopify draftOrderCreate: ${errs.map(e => e.message).join('; ')}`)
    }
    const draft = data.draftOrderCreate.draftOrder
    if (!draft) throw new Error('shopify draftOrderCreate: no draftOrder returned')
    return {
      id: draft.id,
      invoiceUrl: draft.invoiceUrl,
      totalPrice: draft.totalPriceSet.shopMoney.amount,
      currencyCode: draft.totalPriceSet.shopMoney.currencyCode,
    }
  }

  /**
   * Mint a single-use (or capped) discount code on the shop. Used by
   * the agent for save-the-sale / loyalty / win-back moments.
   */
  async createDiscountCode(args: DiscountCodeInput): Promise<DiscountCodeResult> {
    const expiresInHours = args.expiresInHours ?? 72
    const usageLimit = args.usageLimit ?? 1
    const endsAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

    // customerGets shape differs by type. For percentage we pass a
    // fractional value (0.10 = 10%); for fixed_amount we pass a money
    // amount in the shop's currency (Shopify infers currency).
    const customerGets =
      args.type === 'percentage'
        ? { value: { percentage: args.value / 100 }, items: { all: true } }
        : { value: { discountAmount: { amount: args.value.toFixed(2), appliesOnEachItem: false } }, items: { all: true } }

    const input = {
      title: args.code,
      code: args.code,
      startsAt: new Date().toISOString(),
      endsAt: endsAt.toISOString(),
      customerSelection: { all: true },
      customerGets,
      appliesOncePerCustomer: usageLimit === 1,
      usageLimit,
    }

    const data = await this.gql<{
      discountCodeBasicCreate: {
        codeDiscountNode: { codeDiscount: { codes: { edges: { node: { code: string } }[] } } } | null
        userErrors: { field: string[]; message: string }[]
      }
    }>(DISCOUNT_CODE_CREATE_MUTATION, { basicCodeDiscount: input })

    const errs = data.discountCodeBasicCreate.userErrors
    if (errs && errs.length > 0) {
      throw new Error(`shopify discountCodeBasicCreate: ${errs.map(e => e.message).join('; ')}`)
    }
    return { code: args.code, expiresAt: endsAt.toISOString() }
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
  featuredImage: { url: string } | null
  variants: { edges: { node: RawVariant }[] }
}

interface RawProductCard {
  id: string
  title: string
  handle: string
  priceRangeV2: { minVariantPrice: RawMoney }
  featuredImage: { url: string } | null
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

function mapProduct(n: RawProduct, shop: string): ProductHit {
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
    featuredImageUrl: n.featuredImage?.url ?? null,
    onlineStoreUrl: `https://${shop}/products/${n.handle}`,
  }
}

function mapProductCard(n: RawProductCard, shop: string): ProductCard {
  return {
    id: n.id,
    title: n.title,
    handle: n.handle,
    price: {
      amount: n.priceRangeV2.minVariantPrice.amount,
      currency: n.priceRangeV2.minVariantPrice.currencyCode,
    },
    imageUrl: n.featuredImage?.url ?? null,
    url: `https://${shop}/products/${n.handle}`,
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
          featuredImage { url }
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

const PRODUCT_CARD_QUERY = `
  query ProductCard($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      priceRangeV2 {
        minVariantPrice { amount currencyCode }
      }
      featuredImage { url }
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

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
        totalPriceSet { shopMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }
`

const DISCOUNT_CODE_CREATE_MUTATION = `
  mutation DiscountCodeCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) { edges { node { code } } }
          }
        }
      }
      userErrors { field message }
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
