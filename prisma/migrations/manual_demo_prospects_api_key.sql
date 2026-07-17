-- Org-scope API key for the outbound prospecting tool (hand-run once).
-- Only the SHA-256 hash lives here; the raw key was handed to Ryan
-- directly and is what the prospecting tool sends as its Bearer token
-- to POST/GET /api/v1/demo-prospects.
INSERT INTO "ApiKey" ("id", "workspaceId", "scope", "name", "prefix", "hashedKey", "createdAt")
VALUES (
  'apik_747c5aeb9fcc1fed294008f0',
  NULL,
  'org',
  'Prospecting tool (voice demos)',
  'vox_live_8cj',
  'c89ea1692ed2e3756ea16d47975bffef291f94ec68ba5a1907f91d174320e938',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
