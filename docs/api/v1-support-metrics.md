# Voxility API v1 — Support Metrics Reference

A read-only HTTP API for pulling support, ticketing, SLA, CSAT, and queue metrics into external dashboards or reporting tools.

**Base path:** `/api/v1`

All endpoints are `GET` only. No data is modified.

---

## Authentication

Every request must carry a Bearer token in the `Authorization` header:

```
Authorization: Bearer vox_live_<token>
```

### Key types

**Workspace key** — created by any workspace admin in *Settings → API Access*. The key is permanently bound to one workspace. You do not need to (and generally should not) pass `workspaceId` on workspace-key requests. If you do pass it, it must match the workspace the key belongs to; any mismatch returns `403 forbidden`.

**Org key** — provisioned by the Voxility maintainer for multi-workspace integrations. An org key:

- Is required for `GET /api/v1/org/*` endpoints.
- On all other (per-workspace) endpoints, **must** include `?workspaceId=<id>` to scope down to a specific workspace. Omitting it returns `422 workspace_required`.

---

## Common query parameters

These parameters apply to every endpoint that accepts a time window. Pagination parameters apply only to list endpoints.

### Time window

Pass either `days` **or** a `from`/`to` pair — not both.

| Parameter | Type | Description |
|-----------|------|-------------|
| `days` | integer | Window length ending now. Range: 1–365. **Default: 30.** |
| `from` | string | Window start date, `YYYY-MM-DD` (inclusive, treated as `T00:00:00Z`). |
| `to` | string | Window end date, `YYYY-MM-DD` (inclusive, treated as `T00:00:00Z`). Defaults to today when `from` is supplied without `to`. |

### Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `brandId` | string | Restrict results to one brand by its ID. Pass the literal string `no_brand` to restrict to unbranded conversations/tickets only. |
| `workspaceId` | string | Required for org-scoped keys on per-workspace endpoints. Ignored (or must match) for workspace-scoped keys. |

### Pagination (list endpoints only)

| Parameter | Type | Description |
|-----------|------|-------------|
| `cursor` | string | Opaque cursor returned as `nextCursor` in the previous page. Omit on the first request. |
| `limit` | integer | Items per page. Maximum: **200**. Default: 50. |

---

## Response envelope

### Success

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": { ... }
}
```

The `org/overview` endpoint omits `workspaceId` from the envelope (it spans all workspaces).

Response headers also carry `x-api-scope`, `x-api-workspace`, and `x-api-key-id` for logging convenience.

### Error

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid API key"
  }
}
```

---

## Status codes

| HTTP status | `code` | When it occurs |
|-------------|--------|----------------|
| 200 | — | Success |
| 401 | `unauthorized` | Missing `Authorization` header; token does not match any active key; key has been revoked |
| 403 | `forbidden` | Workspace key used against a different workspace; workspace key used on an `/org/*` endpoint |
| 404 | `not_found` | Resource does not exist within the authenticated scope |
| 422 | `bad_param` | `days` is outside the 1–365 range |
| 422 | `workspace_required` | Org key called a per-workspace endpoint without `?workspaceId` |
| 500 | `internal` | Unexpected server error |

---

## Endpoints

### GET /api/v1/support/overview

A single-call summary that aggregates tickets, CSAT, SLA attainment, and live queue state for the workspace.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": {
    "tickets": {
      "open": 14,
      "created": 87,
      "closed": 73,
      "avgResolutionHours": 5.2
    },
    "csat": {
      "avgRating": 4.61,
      "responseRate": 0.342,
      "totalRated": 38
    },
    "sla": {
      "tracked": true,
      "firstResponseAttainment": 91,
      "resolutionAttainment": 84
    },
    "queue": {
      "depth": 3,
      "availableAgents": 5,
      "maxConcurrentHumanChats": 4,
      "queueEnabled": true,
      "longestWaitSecs": 127
    }
  }
}
```

**Field notes:**

- `tickets.open` — current snapshot of tickets in `open`, `pending`, or `on_hold` status, not limited to the window.
- `tickets.avgResolutionHours` — average hours from `createdAt` to `closedAt` for tickets closed in the window; `null` if no tickets were closed.
- `csat.responseRate` — fraction of ended conversations in the window that received a CSAT rating (e.g. `0.342` = 34.2%).
- `sla.firstResponseAttainment` and `sla.resolutionAttainment` — percentage of tickets that met the configured target, or `null` when `tracked` is `false`.
- `queue.maxConcurrentHumanChats` — workspace cap per operator; `null` if not configured.
- `queue.longestWaitSecs` — seconds since the oldest currently-queued, unassigned conversation entered the queue; `0` if the queue is empty.

---

### GET /api/v1/tickets/metrics

Full ticket analytics for the window: scorecards, period-over-period trend, distributions by status/priority/brand/operator, and daily created-vs-closed series.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": {
    "scorecards": {
      "open": 14,
      "created": 87,
      "closed": 73,
      "avgResolutionHours": 5.2
    },
    "trend": {
      "deltaCreated": 12,
      "deltaClosed": 8,
      "deltaAvgResolutionHours": -0.4,
      "priorCreated": 75,
      "priorClosed": 65,
      "priorAvgResolutionHours": 5.6
    },
    "byStatus": [
      { "status": "open", "count": 9 },
      { "status": "pending", "count": 3 },
      { "status": "closed", "count": 71 },
      { "status": "on_hold", "count": 2 }
    ],
    "byPriority": [
      { "priority": "urgent", "count": 5 },
      { "priority": "high", "count": 18 },
      { "priority": "normal", "count": 54 },
      { "priority": "low", "count": 10 }
    ],
    "byBrand": [
      {
        "brandId": "brand_xyz",
        "name": "Acme Support",
        "color": "#3B82F6",
        "count": 42,
        "openCount": 7,
        "avgResolutionHours": 4.8
      }
    ],
    "byOperator": [
      {
        "userId": "usr_111",
        "name": "Jordan Kim",
        "email": "jordan@example.com",
        "image": null,
        "count": 31,
        "openCount": 4,
        "avgResolutionHours": 3.9
      }
    ],
    "created": [
      { "day": "2025-06-23", "count": 4 },
      { "day": "2025-06-24", "count": 2 }
    ],
    "closed": [
      { "day": "2025-06-23", "count": 3 },
      { "day": "2025-06-24", "count": 1 }
    ],
    "allBrands": [
      { "id": "brand_xyz", "name": "Acme Support", "primaryColor": "#3B82F6" }
    ]
  }
}
```

**Field notes:**

- `trend` — compares the current window against the immediately preceding window of the same duration. `null` delta fields indicate the prior period had no data to compare against.
- `byStatus` — only statuses that appear in the window are included.
- `byPriority` — always returns all four priorities (`urgent`, `high`, `normal`, `low`) with `count: 0` for empty ones.
- `created` / `closed` — one entry per calendar day in the window; days with no activity have `count: 0`.
- `allBrands` — full list of brands in the workspace regardless of ticket activity, for use in filter UIs.

---

### GET /api/v1/tickets

Paginated list of tickets created in the window.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`, `cursor`, `limit`

Results are ordered by `createdAt` descending.

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": {
    "items": [
      {
        "id": "tkt_aaa111",
        "ticketNumber": 204,
        "subject": "Can't log into my account",
        "status": "open",
        "priority": "high",
        "contactEmail": "user@example.com",
        "contactName": "Alex Rivera",
        "assignedUserId": "usr_111",
        "createdAt": "2025-06-24T09:12:00.000Z",
        "closedAt": null,
        "lastActivityAt": "2025-06-24T10:05:00.000Z",
        "brandId": "brand_xyz"
      }
    ],
    "nextCursor": "tkt_bbb222"
  }
}
```

Pass `nextCursor` as `?cursor=<value>` on the next request to fetch the following page. When `nextCursor` is `null` you have reached the last page.

---

### GET /api/v1/tickets/{id}

Fetch a single ticket by its ID, including all messages in chronological order.

**Path param:** `id` — the ticket ID (e.g. `tkt_aaa111`)

**Query params:** `workspaceId` (org key only)

Note: the route also accepts `from`/`to`/`brandId` params but does not filter the ticket by them — they are accepted for consistency and ignored in the lookup.

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "data": {
    "id": "tkt_aaa111",
    "ticketNumber": 204,
    "subject": "Can't log into my account",
    "status": "open",
    "priority": "high",
    "contactEmail": "user@example.com",
    "contactName": "Alex Rivera",
    "assignedUserId": "usr_111",
    "createdAt": "2025-06-24T09:12:00.000Z",
    "closedAt": null,
    "lastActivityAt": "2025-06-24T10:05:00.000Z",
    "brandId": "brand_xyz",
    "messages": [
      {
        "id": "msg_001",
        "direction": "inbound",
        "body": "I can't log in — it says my password is wrong.",
        "createdAt": "2025-06-24T09:12:00.000Z"
      },
      {
        "id": "msg_002",
        "direction": "outbound",
        "body": "Hi Alex, let's get that sorted. Can you try a password reset?",
        "createdAt": "2025-06-24T09:24:00.000Z"
      }
    ]
  }
}
```

Returns `404 not_found` when the ticket does not exist or belongs to a different workspace.

---

### GET /api/v1/csat/metrics

Full CSAT analytics: headline scores, distribution, per-agent/operator/brand rollups, AI-vs-human breakdown, period trend, comment highlights, and the 30 most recent responses.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`

Additional filters:

| Parameter | Values | Description |
|-----------|--------|-------------|
| `rating` | `1`–`5` | Restrict to one star rating. |
| `handler` | `ai` or `human` | Restrict to conversations handled exclusively by AI or that were at any point assigned to a human operator. |

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": {
    "totalRated": 38,
    "closedTotal": 111,
    "responseRate": 0.342,
    "averageRating": 4.61,
    "distribution": { "1": 1, "2": 2, "3": 3, "4": 10, "5": 22 },
    "byAgent": [
      { "agentId": "agt_001", "name": "Aria", "count": 22, "avg": 4.72 }
    ],
    "byOperator": [
      {
        "userId": "usr_111",
        "name": "Jordan Kim",
        "email": "jordan@example.com",
        "image": null,
        "count": 8,
        "avg": 4.38
      }
    ],
    "byBrand": [
      { "brandId": "brand_xyz", "name": "Acme Support", "color": "#3B82F6", "count": 38, "avg": 4.61 }
    ],
    "byHandler": {
      "ai":    { "count": 30, "avg": 4.71 },
      "human": { "count": 8,  "avg": 4.25 }
    },
    "trend": {
      "priorAvg": 4.45,
      "priorCount": 29,
      "priorResponseRate": 0.298,
      "deltaAvg": 0.16,
      "deltaCount": 9,
      "deltaResponseRate": 0.044
    },
    "commentHighlights": {
      "needsReview": [
        {
          "conversationId": "conv_xxx",
          "widgetName": "Support Chat",
          "brandName": "Acme Support",
          "agentName": "Aria",
          "operatorName": null,
          "handler": "ai",
          "rating": 2,
          "comment": "Took way too long to understand my problem.",
          "submittedAt": "2025-06-20T14:30:00.000Z",
          "visitorLabel": "user@example.com"
        }
      ],
      "brightSpots": [
        {
          "conversationId": "conv_yyy",
          "widgetName": "Support Chat",
          "brandName": "Acme Support",
          "agentName": "Aria",
          "operatorName": null,
          "handler": "ai",
          "rating": 5,
          "comment": "Resolved in under a minute. Impressive.",
          "submittedAt": "2025-06-22T11:00:00.000Z",
          "visitorLabel": "Anonymous visitor"
        }
      ]
    },
    "allBrands": [
      { "id": "brand_xyz", "name": "Acme Support", "primaryColor": "#3B82F6" }
    ],
    "recent": [
      {
        "conversationId": "conv_yyy",
        "widgetId": "wgt_001",
        "widgetName": "Support Chat",
        "brandId": "brand_xyz",
        "brandName": "Acme Support",
        "agentId": "agt_001",
        "agentName": "Aria",
        "handler": "ai",
        "rating": 5,
        "comment": "Resolved in under a minute. Impressive.",
        "submittedAt": "2025-06-22T11:00:00.000Z",
        "visitorLabel": "Anonymous visitor"
      }
    ],
    "scorecards": {
      "totalRated": 38,
      "responseRate": 0.342,
      "avgRating": 4.61,
      "breakdown": { "1": 1, "2": 2, "3": 3, "4": 10, "5": 22 }
    }
  }
}
```

**Field notes:**

- `commentHighlights.needsReview` — up to 5 rated-1-to-3 responses that include a comment, sorted lowest rating first.
- `commentHighlights.brightSpots` — up to 5 rated-4-or-5 responses with comments, sorted highest first.
- `recent` — the 30 most recent rated responses in the window, regardless of comment presence.
- `scorecards` — convenience sub-object containing the same headline numbers at a predictable path; useful when you only need the summary figures.

---

### GET /api/v1/csat/responses

Cursor-paginated raw list of CSAT-rated conversations in the window.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`, `cursor`, `limit`

Additional filters: `rating` (1–5), `handler` (`ai` or `human`)

Results are ordered by `csatSubmittedAt` descending.

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": {
    "items": [
      {
        "id": "conv_yyy",
        "csatRating": 5,
        "csatComment": "Resolved in under a minute. Impressive.",
        "csatSubmittedAt": "2025-06-22T11:00:00.000Z",
        "assignedUserId": null,
        "agentId": "agt_001"
      }
    ],
    "nextCursor": "conv_zzz"
  }
}
```

---

### GET /api/v1/sla/metrics

SLA attainment summary for tickets created in the window. Returns overall first-response and resolution attainment rates, plus a per-priority breakdown.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": {
    "tracked": true,
    "firstResponseAttainment": 91,
    "resolutionAttainment": 84,
    "firstResponseBreaches": 7,
    "resolutionBreaches": 11,
    "byPriority": [
      {
        "priority": "urgent",
        "firstResponseAttainment": 80,
        "resolutionAttainment": 75
      },
      {
        "priority": "high",
        "firstResponseAttainment": 94,
        "resolutionAttainment": 88
      },
      {
        "priority": "normal",
        "firstResponseAttainment": 97,
        "resolutionAttainment": 90
      },
      {
        "priority": "low",
        "firstResponseAttainment": null,
        "resolutionAttainment": null
      }
    ]
  }
}
```

**Field notes:**

- `tracked: false` — no enabled SLA policies exist for this workspace. All attainment fields will be `null`. Configure policies in *Settings → SLA Policies*.
- `firstResponseAttainment` / `resolutionAttainment` — percentage (0–100) of in-window tickets that met the configured target for their priority. `null` when no policy target applies.
- Per-priority attainment is `null` when no policy target is configured for that priority level and no "default" policy covers it.
- Attainment is calculated from the first outbound reply (or the time a human was assigned, whichever comes first) for first-response; and from `closedAt` for resolution.

---

### GET /api/v1/sla/breaches

Paginated list of tickets from the window that breached at least one SLA target (first-response or resolution). Up to 100 results by default; override with `?limit=<n>`.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`, `limit`

Results are ordered by `createdAt` descending.

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": [
    {
      "id": "tkt_ccc333",
      "ticketNumber": 198,
      "subject": "Billing discrepancy on June invoice",
      "priority": "high",
      "status": "closed",
      "firstResponseMins": 87,
      "firstResponseTarget": 60,
      "firstResponseBreached": true,
      "resolutionMins": 1440,
      "resolutionTarget": 480,
      "resolutionBreached": true
    }
  ]
}
```

**Field notes:**

- `firstResponseMins` / `resolutionMins` — actual elapsed minutes. `null` if the event has not yet occurred (e.g. no outbound reply yet, or ticket still open).
- `firstResponseBreached` / `resolutionBreached` — `true` only when both the actual value and the policy target are known and the actual exceeds the target.

---

### GET /api/v1/queue/snapshot

Live snapshot of the support queue. This endpoint does not accept a time window — it reflects the current state at the moment of the request.

**Query params:** `workspaceId` (org key only)

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "data": {
    "depth": 3,
    "availableAgents": 5,
    "maxConcurrentHumanChats": 4,
    "queueEnabled": true,
    "longestWaitSecs": 127
  }
}
```

**Field notes:**

- `depth` — number of conversations currently in queue (queued and unassigned, not ended).
- `availableAgents` — workspace members with `isAvailable: true` and a role other than `viewer`.
- `maxConcurrentHumanChats` — the per-operator concurrency limit set in live-chat settings; `null` if not configured.
- `longestWaitSecs` — seconds since the longest-waiting queued conversation entered the queue; `0` when the queue is empty.

---

### GET /api/v1/operators

Operator performance summary: ticket counts and open-ticket load per team member for the window.

**Query params:** `days` / `from` / `to`, `brandId`, `workspaceId`

**Example response:**

```json
{
  "scope": "workspace",
  "workspaceId": "ws_abc123",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": [
    {
      "userId": "usr_111",
      "name": "Jordan Kim",
      "email": "jordan@example.com",
      "image": null,
      "isAvailable": true,
      "assigned": 31,
      "open": 4
    },
    {
      "userId": "usr_222",
      "name": "Sam Lee",
      "email": "sam@example.com",
      "image": "https://example.com/avatars/sam.jpg",
      "isAvailable": false,
      "assigned": 18,
      "open": 0
    }
  ]
}
```

**Field notes:**

- All non-viewer workspace members are included in the list, even those with zero tickets in the window.
- `assigned` — total tickets assigned to this operator that were created in the window.
- `open` — subset of assigned tickets currently in `open`, `pending`, or `on_hold` status (snapshot, not window-scoped).
- `isAvailable` — live availability flag (relevant to queue routing).

---

### GET /api/v1/org/overview

Aggregated overview across all workspaces in the org. **Requires an org-scoped key.** Workspace keys return `403 forbidden`.

**Query params:** `days` / `from` / `to` (no `workspaceId` or `brandId`)

**Example response:**

```json
{
  "scope": "org",
  "from": "2025-05-25T00:00:00.000Z",
  "to": "2025-06-24T00:00:00.000Z",
  "data": {
    "totals": {
      "ticketsOpen": 42,
      "ticketsCreated": 310,
      "ticketsClosed": 267,
      "queueDepth": 7
    },
    "workspaces": [
      {
        "workspaceId": "ws_abc123",
        "name": "Acme Corp",
        "tickets": {
          "open": 14,
          "created": 87,
          "closed": 73,
          "avgResolutionHours": 5.2
        },
        "csat": {
          "avgRating": 4.61,
          "responseRate": 0.342,
          "totalRated": 38
        },
        "sla": {
          "tracked": true,
          "firstResponseAttainment": 91,
          "resolutionAttainment": 84
        },
        "queue": {
          "depth": 3,
          "availableAgents": 5,
          "maxConcurrentHumanChats": 4,
          "queueEnabled": true,
          "longestWaitSecs": 127
        }
      }
    ]
  }
}
```

**Field notes:**

- `totals` — cross-workspace sums for open tickets, created tickets, closed tickets, and queue depth. CSAT and SLA are not summed at the org level (they are averages of averages, which is misleading); use the per-workspace entries instead.
- `workspaces` — one entry per workspace with the same shape as `GET /api/v1/support/overview`.

---

## Notes

### SLA tracking

SLA attainment fields (`firstResponseAttainment`, `resolutionAttainment`) are `null` and `tracked` is `false` when the workspace has configured no enabled SLA policies. To start tracking SLA, configure at least one policy in *Settings → SLA Policies*.

### Rate limiting

No rate limit is enforced in v1. All requests are logged (key ID, timestamp, workspace) for audit purposes.

### Read-only

All v1 API endpoints are read-only. No endpoint creates, updates, or deletes any data.

### Pagination

Cursors are opaque strings (ticket/conversation IDs). They are stable within a single query — if records are created between pages the cursor still advances correctly, but the new records will not appear in subsequent pages of the current request. Re-fetch from page 1 to pick up new data.
