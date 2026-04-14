# HubSpot API v3 -- CRM Adapter Mapping

> Reference for implementing `HubSpotAdapter` against the `CrmAdapter` interface.
> All endpoints use base URL `https://api.hubspot.com`.
> Auth: `Authorization: Bearer <access_token>` header on every request.

---

## Table of Contents

1. [Authentication & Token Management](#1-authentication--token-management)
2. [Contacts](#2-contacts)
3. [Conversations & Messaging](#3-conversations--messaging)
4. [Opportunities / Deals](#4-opportunities--deals)
5. [Calendar / Meetings](#5-calendar--meetings)
6. [Supporting APIs](#6-supporting-apis)
7. [Key GHL-to-HubSpot Differences](#7-key-ghl-to-hubspot-differences)
8. [Required OAuth Scopes](#8-required-oauth-scopes)

---

## 1. Authentication & Token Management

Already implemented in `app/api/auth/hubspot/route.ts` and `callback/route.ts`.

| Item | Detail |
|------|--------|
| OAuth authorize URL | `https://app.hubspot.com/oauth/authorize` |
| Token endpoint | `POST https://api.hubapi.com/oauth/v1/token` |
| Grant types | `authorization_code` (initial), `refresh_token` (renewal) |
| Token refresh body | `grant_type=refresh_token&client_id=...&client_secret=...&refresh_token=...` |
| Token lifetime | ~30 minutes (use `expires_in` from response) |
| Header format | `Authorization: Bearer <access_token>` |

**Adapter note:** The `apiFetch` wrapper must check `expiresAt` and refresh before each call, similar to the GHL token store pattern.

---

## 2. Contacts

### 2.1 getContact(contactId)

| | GHL | HubSpot |
|---|---|---|
| Method | `GET` | `GET` |
| Path | `/contacts/{contactId}` | `/crm/v3/objects/contacts/{contactId}` |
| Query params | -- | `properties=firstname,lastname,email,phone,...` |
| Response shape | `{ contact: Contact }` | `{ id, properties: { firstname, lastname, email, phone, ... }, createdAt, updatedAt }` |

**HubSpot request:**
```
GET /crm/v3/objects/contacts/{contactId}?properties=firstname,lastname,email,phone,hs_object_id
```

**Response:**
```json
{
  "id": "123",
  "properties": {
    "firstname": "John",
    "lastname": "Doe",
    "email": "john@example.com",
    "phone": "+15551234567",
    "createdate": "2024-01-01T00:00:00.000Z",
    "lastmodifieddate": "2024-06-01T00:00:00.000Z"
  },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-06-01T00:00:00.000Z",
  "archived": false
}
```

**Mapping to `Contact` interface:**
```ts
{
  id:           hs.id,
  locationId:   this.locationId,  // not from HS -- injected
  firstName:    hs.properties.firstname,
  lastName:     hs.properties.lastname,
  name:         `${hs.properties.firstname ?? ''} ${hs.properties.lastname ?? ''}`.trim(),
  email:        hs.properties.email,
  phone:        hs.properties.phone,
  tags:         parseMultiSelectProperty(hs.properties.hs_tag),  // see section 2.6
  customFields: mapCustomProperties(hs.properties),
  dateAdded:    hs.createdAt,
  dateUpdated:  hs.updatedAt,
}
```

### 2.2 searchContacts(query)

| | GHL | HubSpot |
|---|---|---|
| Method | `GET` | `POST` |
| Path | `/contacts/?locationId=...&query=...` | `/crm/v3/objects/contacts/search` |

**HubSpot request body (full-text search):**
```json
{
  "query": "john doe",
  "properties": ["firstname", "lastname", "email", "phone"],
  "limit": 20,
  "after": 0
}
```

**HubSpot request body (filter-based search):**
```json
{
  "filterGroups": [
    {
      "filters": [
        {
          "propertyName": "email",
          "operator": "CONTAINS_TOKEN",
          "value": "*@example.com"
        }
      ]
    }
  ],
  "properties": ["firstname", "lastname", "email", "phone"],
  "limit": 20
}
```

**Available operators:** `EQ`, `NEQ`, `LT`, `LTE`, `GT`, `GTE`, `BETWEEN`, `IN`, `NOT_IN`, `HAS_PROPERTY`, `NOT_HAS_PROPERTY`, `CONTAINS_TOKEN`, `NOT_CONTAINS_TOKEN`

**Constraints:** Max 5 filterGroups, 6 filters each. Max 10,000 total results. Rate: 5 req/s.

**Response:**
```json
{
  "total": 1,
  "results": [
    { "id": "123", "properties": { ... }, "createdAt": "...", "updatedAt": "..." }
  ],
  "paging": { "next": { "after": "123" } }
}
```

### 2.3 createContact(payload)

| | GHL | HubSpot |
|---|---|---|
| Method | `POST` | `POST` |
| Path | `/contacts/` | `/crm/v3/objects/contacts` |
| Body shape | `{ firstName, lastName, email, locationId, ... }` | `{ properties: { firstname, lastname, email, ... } }` |

**HubSpot request:**
```json
{
  "properties": {
    "firstname": "John",
    "lastname": "Doe",
    "email": "john@example.com",
    "phone": "+15551234567"
  }
}
```

### 2.4 updateContact(contactId, payload)

| | GHL | HubSpot |
|---|---|---|
| Method | `PUT` | `PATCH` |
| Path | `/contacts/{contactId}` | `/crm/v3/objects/contacts/{contactId}` |
| Body | flat fields | `{ properties: { ... } }` |

**HubSpot request:**
```json
{
  "properties": {
    "firstname": "Jane",
    "phone": "+15559876543"
  }
}
```

### 2.5 addTags(contactId, tags) -- CRITICAL DIFFERENCE

**GHL:** Has native tags -- `POST /contacts/{id}/tags` with `{ tags: ["tag1", "tag2"] }`.

**HubSpot:** No native tags. Use a **multi-select (checkbox/enumeration) custom property**.

**Implementation strategy:**
1. Create a custom property `hs_tag` (or any name) of type `enumeration` / fieldType `checkbox`.
2. To "add tags", read the current property value, merge new tags, and PATCH.
3. Multi-select values are stored as **semicolon-separated strings**: `"tag1;tag2;tag3"`.

**Adding tags flow:**
```ts
async addTags(contactId: string, tags: string[]): Promise<void> {
  // 1. Get current tags
  const contact = await this.getContact(contactId)
  const currentTags = (contact.properties.hs_tag || '').split(';').filter(Boolean)

  // 2. Merge (deduplicate)
  const merged = [...new Set([...currentTags, ...tags])]

  // 3. IMPORTANT: Each tag value must already exist as an option on the property.
  //    You may need to call createPropertyOption() first for new tag values.

  // 4. Update
  await this.apiFetch(`/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { hs_tag: merged.join(';') } })
  })
}
```

**Creating the tag property (one-time setup):**
```
POST /crm/v3/properties/contacts
{
  "name": "hs_tag",
  "label": "Tags",
  "type": "enumeration",
  "fieldType": "checkbox",
  "groupName": "contactinformation",
  "options": [
    { "label": "VIP", "value": "VIP" },
    { "label": "Lead", "value": "Lead" }
  ]
}
```

**Adding a new option to existing property:**
```
PATCH /crm/v3/properties/contacts/hs_tag
{
  "options": [ ...existingOptions, { "label": "NewTag", "value": "NewTag" } ]
}
```

### 2.6 updateContactField(contactId, fieldKey, value)

| | GHL | HubSpot |
|---|---|---|
| Path | `PUT /contacts/{id}` with `customFields` array | `PATCH /crm/v3/objects/contacts/{id}` |
| Body | `{ customFields: [{ key, field_value }] }` | `{ properties: { [fieldKey]: value } }` |

In HubSpot, standard and custom properties are set the same way -- flat in `properties`:
```json
{ "properties": { "my_custom_field": "some value" } }
```

### 2.7 getCustomFields()

| | GHL | HubSpot |
|---|---|---|
| Path | `GET /locations/{id}/customFields` | `GET /crm/v3/properties/contacts` |
| Response | `{ customFields: [...] }` | `{ results: [...] }` |

**HubSpot response item:**
```json
{
  "name": "favorite_food",
  "label": "Favorite Food",
  "type": "string",
  "fieldType": "text",
  "groupName": "contactinformation",
  "options": [],
  "createdAt": "...",
  "updatedAt": "...",
  "hidden": false
}
```

**Mapping to `CustomField` interface:**
```ts
{
  id:          prop.name,           // HubSpot uses name as identifier
  name:        prop.label,
  fieldKey:    prop.name,
  dataType:    prop.type,
  placeholder: undefined,
  position:    prop.displayOrder,
}
```

---

## 3. Conversations & Messaging

HubSpot uses the Conversations v3 API with a thread-based model (vs GHL's conversation model).

**Base path:** `/conversations/v3/conversations`

### 3.1 searchConversations(opts)

| | GHL | HubSpot |
|---|---|---|
| Method | `GET` | `GET` |
| Path | `/conversations/search?locationId=...&contactId=...` | `/conversations/v3/conversations/threads` |
| Filter by contact | `contactId` query param | `associatedContactId` query param |

**HubSpot request:**
```
GET /conversations/v3/conversations/threads?associatedContactId={contactId}&limit=20&sort=latestMessageTimestampDescending
```

**Query parameters:**
- `associatedContactId` -- filter by contact
- `inboxId` -- filter by inbox
- `limit` -- max 500
- `after` -- pagination cursor
- `sort` -- sort field
- `archived` -- include archived (default false)

**Response:**
```json
{
  "results": [
    {
      "id": "thread-123",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-06-01T00:00:00Z",
      "status": "OPEN",
      "archived": false,
      "inboxId": "456",
      "latestMessageTimestamp": "2024-06-01T00:00:00Z"
    }
  ],
  "paging": { "next": { "after": "..." } }
}
```

**Mapping to `Conversation` interface:**
```ts
{
  id:              thread.id,
  locationId:      this.locationId,
  contactId:       opts.contactId ?? '',       // from the query param
  lastMessageDate: thread.latestMessageTimestamp,
  type:            'thread',
  unreadCount:     0,                          // not directly available
}
```

### 3.2 getConversation(conversationId)

| | GHL | HubSpot |
|---|---|---|
| Path | `/conversations/{id}` | `/conversations/v3/conversations/threads/{threadId}` |

**HubSpot request:**
```
GET /conversations/v3/conversations/threads/{threadId}
```

### 3.3 getMessages(conversationId, limit)

| | GHL | HubSpot |
|---|---|---|
| Path | `/conversations/{id}/messages?limit=20` | `/conversations/v3/conversations/threads/{threadId}/messages` |

**HubSpot response:**
```json
{
  "results": [
    {
      "id": "msg-456",
      "type": "MESSAGE",
      "createdAt": "2024-06-01T00:00:00Z",
      "text": "Hello!",
      "richText": "<p>Hello!</p>",
      "senderActorId": "A-12345",
      "recipients": [{ "actorId": "V-67890" }],
      "channelId": "1000",
      "channelAccountId": "abc123"
    }
  ]
}
```

**Mapping to `Message` interface:**
```ts
{
  id:             msg.id,
  conversationId: threadId,
  locationId:     this.locationId,
  contactId:      extractContactFromActorId(msg.senderActorId),
  body:           msg.text,
  direction:      msg.senderActorId.startsWith('A-') ? 'outbound' : 'inbound',
  status:         msg.status?.statusType,
  messageType:    mapChannelIdToType(msg.channelId),
  dateAdded:      msg.createdAt,
  contentType:    msg.richText ? 'html' : 'text',
}
```

**Channel ID mapping:**
| channelId | Type |
|-----------|------|
| `1000` | Live_Chat |
| `1001` | FB (Facebook Messenger) |
| `1002` | Email |

**Actor ID prefixes:**
| Prefix | Meaning |
|--------|---------|
| `A-{number}` | HubSpot user (agent) |
| `V-{number}` | Visitor/contact |
| `E-{email}` | Email address |
| `S-hubspot` | System |
| `I-{number}` | Integration |

### 3.4 sendMessage(payload)

| | GHL | HubSpot |
|---|---|---|
| Method | `POST` | `POST` |
| Path | `/conversations/messages` | `/conversations/v3/conversations/threads/{threadId}/messages` |
| Body | `{ type, contactId, message }` | `{ type, text, senderActorId, channelId, channelAccountId, recipients }` |

**CRITICAL DIFFERENCE:** HubSpot sends messages within an existing thread. You must have a `threadId` first. GHL creates conversations implicitly.

**HubSpot request:**
```json
{
  "type": "MESSAGE",
  "text": "Hello! How can I help?",
  "richText": "<p>Hello! How can I help?</p>",
  "senderActorId": "A-12345",
  "channelId": "1000",
  "channelAccountId": "abc-def",
  "recipients": [
    {
      "actorId": "V-67890",
      "recipientField": "TO"
    }
  ]
}
```

**For email messages, add:**
```json
{
  "channelId": "1002",
  "subject": "Re: Your inquiry",
  "recipients": [
    { "actorId": "E-customer@example.com", "recipientField": "TO" }
  ]
}
```

**Adapter implementation notes:**
1. To send a message, you need to find (or create) a thread for the contact first.
2. Look up threads with `GET /conversations/v3/conversations/threads?associatedContactId={contactId}`.
3. If no thread exists, you may need to create one through HubSpot's channel-specific flow.
4. The `senderActorId` must be a valid HubSpot user ID (the integration/bot user).
5. `channelAccountId` identifies which connected channel account to send from.

**Required scopes:** `conversations.read`, `conversations.write`

---

## 4. Opportunities / Deals

HubSpot calls these **Deals** (not Opportunities).

### 4.1 getOpportunitiesForContact(contactId)

This requires two API calls in HubSpot:
1. Get associated deal IDs via the Associations API.
2. Batch-read the deals.

**Step 1 -- Get associated deal IDs:**
```
POST /crm/v4/associations/contacts/deals/batch/read
{
  "inputs": [{ "id": "{contactId}" }]
}
```

**Step 1 response:**
```json
{
  "results": [
    {
      "from": { "id": "contact-123" },
      "to": [
        { "toObjectId": "deal-456", "associationTypes": [{ "category": "HUBSPOT_DEFINED", "typeId": 4 }] }
      ]
    }
  ]
}
```

**Step 2 -- Batch-read deals:**
```
POST /crm/v3/objects/deals/batch/read
{
  "inputs": [{ "id": "deal-456" }],
  "properties": ["dealname", "dealstage", "pipeline", "amount", "closedate", "hubspot_owner_id"]
}
```

**Alternative (simpler, single call):** Use the search API:
```
POST /crm/v3/objects/deals/search
{
  "filterGroups": [
    {
      "filters": [
        {
          "propertyName": "associations.contact",
          "operator": "EQ",
          "value": "{contactId}"
        }
      ]
    }
  ],
  "properties": ["dealname", "dealstage", "pipeline", "amount", "closedate"]
}
```

**Mapping to `Opportunity` interface:**
```ts
{
  id:              deal.id,
  name:            deal.properties.dealname,
  locationId:      this.locationId,
  contactId:       contactId,                          // from the query
  pipelineId:      deal.properties.pipeline,
  pipelineStageId: deal.properties.dealstage,
  status:          deal.properties.dealstage,          // map stage to status
  monetaryValue:   Number(deal.properties.amount),
  assignedTo:      deal.properties.hubspot_owner_id,
  createdAt:       deal.createdAt,
  updatedAt:       deal.updatedAt,
}
```

### 4.2 updateOpportunityStage(opportunityId, stageId)

| | GHL | HubSpot |
|---|---|---|
| Method | `PUT` | `PATCH` |
| Path | `/opportunities/{id}` | `/crm/v3/objects/deals/{dealId}` |
| Body | `{ pipelineStageId }` | `{ properties: { dealstage: stageId } }` |

**HubSpot request:**
```json
PATCH /crm/v3/objects/deals/{dealId}
{
  "properties": {
    "dealstage": "closedwon"
  }
}
```

**NOTE:** `dealstage` uses internal stage IDs. Get them from the Pipelines API (see section 6.1).

### 4.3 createOpportunity(payload)

| | GHL | HubSpot |
|---|---|---|
| Method | `POST` | `POST` + association |
| Path | `/opportunities/` | `/crm/v3/objects/deals` |

**HubSpot request (create + associate in one call):**
```json
POST /crm/v3/objects/deals
{
  "properties": {
    "dealname": "New Deal",
    "dealstage": "appointmentscheduled",
    "pipeline": "default",
    "amount": "5000",
    "closedate": "2024-12-31"
  },
  "associations": [
    {
      "to": { "id": "{contactId}" },
      "types": [
        {
          "associationCategory": "HUBSPOT_DEFINED",
          "associationTypeId": 3
        }
      ]
    }
  ]
}
```

**Association type IDs for deals:**
| typeId | Meaning |
|--------|---------|
| 3 | Deal to Contact |
| 4 | Contact to Deal (reverse) |
| 5 | Deal to Company |
| 341 | Deal to Meeting |

### 4.4 updateOpportunityValue(opportunityId, monetaryValue)

| | GHL | HubSpot |
|---|---|---|
| Path | `PUT /opportunities/{id}` | `PATCH /crm/v3/objects/deals/{dealId}` |
| Body | `{ monetaryValue }` | `{ properties: { amount: "5000" } }` |

**HubSpot request:**
```json
PATCH /crm/v3/objects/deals/{dealId}
{
  "properties": {
    "amount": "7500.00"
  }
}
```

**NOTE:** `amount` is a string in HubSpot (not a number).

---

## 5. Calendar / Meetings

**CRITICAL DIFFERENCE:** HubSpot does NOT have a calendar availability/booking API equivalent to GHL's calendar system. HubSpot's Meetings API is for logging/managing meeting engagement records, not for checking free slots or booking through scheduling pages.

### 5.1 getFreeSlots(calendarId, startDate, endDate, timezone)

**GHL:** `GET /calendars/{calendarId}/free-slots?startDate=...&endDate=...`

**HubSpot:** No direct equivalent API endpoint.

**Workaround options:**
1. **Use Google Calendar / Outlook API directly** -- if the HubSpot user has connected their calendar, use the respective calendar API for availability.
2. **Use HubSpot Scheduling Pages** -- HubSpot has scheduling links (like Calendly), but no public API to query availability programmatically.
3. **Search existing meetings to infer busy times:**
   ```
   POST /crm/v3/objects/meetings/search
   {
     "filterGroups": [{
       "filters": [
         { "propertyName": "hs_meeting_start_time", "operator": "GTE", "value": "2024-06-01T00:00:00Z" },
         { "propertyName": "hs_meeting_end_time", "operator": "LTE", "value": "2024-06-07T23:59:59Z" }
       ]
     }],
     "properties": ["hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_title"]
   }
   ```

**Recommendation:** Throw `NotSupportedError` or integrate with Google Calendar API as a secondary provider for scheduling.

### 5.2 bookAppointment(payload)

**GHL:** `POST /calendars/events/appointments`

**HubSpot:** Create a meeting engagement and associate it with the contact.

```json
POST /crm/v3/objects/meetings
{
  "properties": {
    "hs_timestamp": "2024-06-15T10:00:00.000Z",
    "hs_meeting_title": "Discovery Call",
    "hs_meeting_start_time": "2024-06-15T10:00:00.000Z",
    "hs_meeting_end_time": "2024-06-15T10:30:00.000Z",
    "hs_meeting_body": "Initial consultation",
    "hs_internal_meeting_notes": "Notes for internal team",
    "hs_meeting_outcome": "SCHEDULED",
    "hs_meeting_location": "https://zoom.us/j/123456"
  },
  "associations": [
    {
      "to": { "id": "{contactId}" },
      "types": [
        { "associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 200 }
      ]
    }
  ]
}
```

**Meeting outcome values:** `SCHEDULED`, `COMPLETED`, `RESCHEDULED`, `NO_SHOW`, `CANCELED`

### 5.3 getAppointment(eventId)

| | GHL | HubSpot |
|---|---|---|
| Path | `GET /calendars/events/appointments/{id}` | `GET /crm/v3/objects/meetings/{meetingId}` |

```
GET /crm/v3/objects/meetings/{meetingId}?properties=hs_meeting_title,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_body,hs_meeting_outcome,hs_internal_meeting_notes
```

### 5.4 updateAppointment(eventId, payload)

| | GHL | HubSpot |
|---|---|---|
| Method | `PUT` | `PATCH` |
| Path | `/calendars/events/appointments/{id}` | `/crm/v3/objects/meetings/{meetingId}` |

```json
PATCH /crm/v3/objects/meetings/{meetingId}
{
  "properties": {
    "hs_meeting_start_time": "2024-06-16T10:00:00.000Z",
    "hs_meeting_end_time": "2024-06-16T10:30:00.000Z",
    "hs_meeting_outcome": "RESCHEDULED"
  }
}
```

### 5.5 getCalendarEvents(contactId)

Find meetings associated with a contact:

**Step 1:** Get associated meeting IDs:
```
GET /crm/v3/objects/contacts/{contactId}/associations/meetings
```

**Step 2:** Batch-read meetings:
```
POST /crm/v3/objects/meetings/batch/read
{
  "inputs": [{ "id": "meeting-123" }, { "id": "meeting-456" }],
  "properties": ["hs_meeting_title", "hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_outcome"]
}
```

### 5.6 createAppointmentNote(appointmentId, body)

**GHL:** `POST /calendars/appointments/{id}/notes` with `{ body }`.

**HubSpot:** Create a Note engagement and associate it with the meeting.

```json
POST /crm/v3/objects/notes
{
  "properties": {
    "hs_timestamp": "2024-06-15T10:00:00.000Z",
    "hs_note_body": "Patient reported improvement in symptoms."
  },
  "associations": [
    {
      "to": { "id": "{meetingId}" },
      "types": [
        { "associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 202 }
      ]
    }
  ]
}
```

**Note properties:**
| Property | Description |
|----------|-------------|
| `hs_timestamp` | Required. Creation time (Unix ms or UTC string) |
| `hs_note_body` | Text content, max 65,536 chars |
| `hubspot_owner_id` | Note creator |
| `hs_attachment_ids` | Semicolon-separated file IDs |

### 5.7 updateAppointmentNote(appointmentId, noteId, body)

```json
PATCH /crm/v3/objects/notes/{noteId}
{
  "properties": {
    "hs_note_body": "Updated note content."
  }
}
```

---

## 6. Supporting APIs

### 6.1 Pipelines & Stages

**List pipelines:**
```
GET /crm/v3/pipelines/deals
```

**List stages for a pipeline:**
```
GET /crm/v3/pipelines/deals/{pipelineId}/stages
```

**Response:**
```json
{
  "results": [
    { "id": "appointmentscheduled", "label": "Appointment Scheduled", "displayOrder": 0 },
    { "id": "qualifiedtobuy", "label": "Qualified To Buy", "displayOrder": 1 },
    { "id": "closedwon", "label": "Closed Won", "displayOrder": 5 }
  ]
}
```

### 6.2 Associations v4

**Get associations between any two object types:**
```
GET /crm/v4/objects/{fromObjectType}/{objectId}/associations/{toObjectType}
```

**Batch read associations:**
```
POST /crm/v4/associations/{fromObjectType}/{toObjectType}/batch/read
{
  "inputs": [{ "id": "123" }]
}
```

**Create association:**
```
PUT /crm/v4/objects/{fromObjectType}/{fromObjectId}/associations/default/{toObjectType}/{toObjectId}
```

### 6.3 Owners (for assignedTo mapping)

```
GET /crm/v3/owners
GET /crm/v3/owners/{ownerId}
```

---

## 7. Key GHL-to-HubSpot Differences

| Concept | GHL | HubSpot | Adapter Impact |
|---------|-----|---------|----------------|
| **Tags** | Native `tags[]` on contacts | Multi-select custom property (enumeration/checkbox) | Must create property, read-merge-write on addTags |
| **Opportunities** | Called "Opportunities" | Called "Deals" | Rename throughout |
| **Contact-to-Deal link** | `contactId` field on opportunity | Association (separate API) | Extra API call to link/query |
| **Custom fields** | Separate `customFields` array with key/value | Flat `properties` object -- custom and standard treated identically | Simplifies updateContactField |
| **Conversations** | Conversation-based model | Thread-based model with Actors | Map conversation to thread |
| **Send message** | Creates conversation implicitly | Must send within existing thread | Need to find/create thread first |
| **Calendar/Free slots** | Native calendar with free-slots API | No availability API -- meetings are engagement logs only | Use external calendar API or throw NotSupported |
| **Appointment notes** | Nested under appointments | Separate Note objects associated via Associations API | Create note + associate |
| **Location/Account** | `locationId` scopes everything | Account-level (portal). No location concept. | Store portalId, ignore locationId for API calls |
| **API versioning** | `Version` header (e.g. `2021-07-28`) | URL path versioning (`/crm/v3/...`) | Set in base URL, no header needed |
| **Update method** | `PUT` (full replace) | `PATCH` (partial update) | Change HTTP methods |
| **Monetary values** | `monetaryValue` (number) | `amount` (string) | Type conversion needed |
| **Pagination** | Varies | Cursor-based with `after` param | Consistent pattern |

---

## 8. Required OAuth Scopes

Update the OAuth authorize URL in `app/api/auth/hubspot/route.ts` to include all needed scopes:

```
crm.objects.contacts.read
crm.objects.contacts.write
crm.objects.deals.read
crm.objects.deals.write
crm.schemas.contacts.read
conversations.read
conversations.write
crm.objects.owners.read
```

**Current scopes in route.ts:**
```
crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write
```

**Missing scopes to add:**
```
conversations.read conversations.write crm.objects.owners.read crm.schemas.contacts.read
```

---

## Quick Reference: All Endpoints

| Adapter Method | HubSpot Endpoint | Method |
|---|---|---|
| `getContact` | `/crm/v3/objects/contacts/{id}` | GET |
| `searchContacts` | `/crm/v3/objects/contacts/search` | POST |
| `createContact` | `/crm/v3/objects/contacts` | POST |
| `updateContact` | `/crm/v3/objects/contacts/{id}` | PATCH |
| `addTags` | `/crm/v3/objects/contacts/{id}` | PATCH (merge multi-select) |
| `updateContactField` | `/crm/v3/objects/contacts/{id}` | PATCH |
| `getCustomFields` | `/crm/v3/properties/contacts` | GET |
| `searchConversations` | `/conversations/v3/conversations/threads` | GET |
| `getConversation` | `/conversations/v3/conversations/threads/{id}` | GET |
| `getMessages` | `/conversations/v3/conversations/threads/{id}/messages` | GET |
| `sendMessage` | `/conversations/v3/conversations/threads/{id}/messages` | POST |
| `getOpportunitiesForContact` | `/crm/v4/associations/contacts/deals/batch/read` + `/crm/v3/objects/deals/batch/read` | POST+POST |
| `updateOpportunityStage` | `/crm/v3/objects/deals/{id}` | PATCH |
| `createOpportunity` | `/crm/v3/objects/deals` | POST |
| `updateOpportunityValue` | `/crm/v3/objects/deals/{id}` | PATCH |
| `getFreeSlots` | No equivalent (use external calendar API) | -- |
| `bookAppointment` | `/crm/v3/objects/meetings` | POST |
| `getAppointment` | `/crm/v3/objects/meetings/{id}` | GET |
| `updateAppointment` | `/crm/v3/objects/meetings/{id}` | PATCH |
| `getCalendarEvents` | `/crm/v3/objects/contacts/{id}/associations/meetings` + batch read | GET+POST |
| `createAppointmentNote` | `/crm/v3/objects/notes` (with association) | POST |
| `updateAppointmentNote` | `/crm/v3/objects/notes/{id}` | PATCH |
