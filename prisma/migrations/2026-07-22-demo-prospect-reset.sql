-- 2026-07-22 — demo-prospect reset for the outbound-integration fix.
-- Hand-run in production. DATA ONLY — no schema change.
--
-- Two one-off retirements requested by the prospecting-tool side:
--
--   1. desert-glow-med-spa-189e3dfc — registered under the WRONG vertical
--      ('gym' instead of 'med-spa'). Root cause was upstream: the tool
--      inherited demo_vertical from the campaign rather than classifying
--      per business, and Desert Glow sat in a gym-vertical campaign. The
--      tool is fixed, but registration is idempotent per websiteDomain
--      (partial unique index DemoProspect_live_domain_key), so a re-POST
--      keeps returning THIS gym-persona slug. The row must be retired
--      before the corrected vertical can take effect.
--
--   2. zz-outbound-integration-test-a3ce25eb — scratch row the tool created
--      to verify write scope + idempotency.
--
-- WHY NOT simply `SET status = 'expired'`:
--   The reaper (app/api/cron/demo-prospect-reaper) selects only
--   status IN ('ready','failed','provisioning') AND expiresAt < now.
--   Flipping straight to 'expired' WOULD free the domain (the partial
--   unique index excludes 'expired'), but the reaper would never see the
--   row again — orphaning its Agent + GeminiVoiceConfig + KnowledgeDomain
--   (and all crawled chunks) in the demos workspace permanently.
--   So instead we backdate expiresAt and let the reaper retire it the
--   designed, race-safe way: it deletes the assets, then sets
--   status = 'expired' itself, which frees the domain.

-- ─────────────────────────────────────────────────────────────────────
-- STEP 0 — inspect first. Note each row's status and whether it has
-- provisioned assets; that decides which step below applies.
-- ─────────────────────────────────────────────────────────────────────
SELECT slug, "businessName", "websiteDomain", vertical, status,
       "agentId", "knowledgeDomainId", "expiresAt", "callCount",
       "claimedByUserId"
FROM "DemoProspect"
WHERE slug IN ('desert-glow-med-spa-189e3dfc',
               'zz-outbound-integration-test-a3ce25eb');

-- SAFETY: if either row shows a non-null "claimedByUserId" or status
-- 'claimed', STOP — that prospect converted to a paying account and must
-- never be retired. Nothing below targets 'claimed', but check anyway.

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — rows that HAVE been provisioned (status ready/failed/
-- provisioning): hand them to the reaper by backdating expiresAt.
-- The reaper deletes the agent + knowledge domain, then marks the row
-- 'expired', which releases the domain for re-registration.
-- ─────────────────────────────────────────────────────────────────────
UPDATE "DemoProspect"
SET "expiresAt" = NOW() - INTERVAL '1 day',
    "updatedAt" = NOW()
WHERE slug IN ('desert-glow-med-spa-189e3dfc',
               'zz-outbound-integration-test-a3ce25eb')
  AND status IN ('ready', 'failed', 'provisioning');

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — rows never visited (status 'registered' ⇒ lazy provisioning
-- never ran ⇒ no agent, no knowledge domain, nothing to orphan).
-- The reaper's CLAIMABLE_STATUSES excludes 'registered' (those are swept
-- separately only after 90 days), so a hard delete is both safe here and
-- the only way to free the domain promptly.
-- Guarded on the asset FKs being null so this can never orphan anything.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM "DemoTryCall"
WHERE "prospectId" IN (
  SELECT id FROM "DemoProspect"
  WHERE slug IN ('desert-glow-med-spa-189e3dfc',
                 'zz-outbound-integration-test-a3ce25eb')
    AND status = 'registered'
    AND "agentId" IS NULL
    AND "knowledgeDomainId" IS NULL
);

DELETE FROM "DemoProspect"
WHERE slug IN ('desert-glow-med-spa-189e3dfc',
               'zz-outbound-integration-test-a3ce25eb')
  AND status = 'registered'
  AND "agentId" IS NULL
  AND "knowledgeDomainId" IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — verify. Any row touched by STEP 1 should now show a past
-- expiresAt; rows handled by STEP 2 should be gone entirely.
-- ─────────────────────────────────────────────────────────────────────
SELECT slug, status, vertical, "agentId", "knowledgeDomainId", "expiresAt"
FROM "DemoProspect"
WHERE slug IN ('desert-glow-med-spa-189e3dfc',
               'zz-outbound-integration-test-a3ce25eb');

-- ─────────────────────────────────────────────────────────────────────
-- STEP 4 — free the domain IMMEDIATELY, without waiting for the cron
-- and without needing CRON_SECRET.
--
-- STEP 1 alone leaves status 'ready', which the partial unique index
-- still counts as a live demo — so the domain stays locked until the
-- reaper next runs (20 3 * * *, i.e. 03:20 UTC daily). If the SQL was
-- run after that window, that's an ~24h wait during which the
-- prospecting tool keeps getting the stale slug back with
-- existing:true and reasonably reads its own fix as broken.
--
-- Use status 'failed' to collapse the wait to zero. It is the one
-- status that appears in BOTH sets:
--
--   partial unique index  → excluded by  NOT IN ('expired','claimed','failed')
--   reaper CLAIMABLE_STATUSES →   listed in  ('ready','failed','provisioning')
--
-- So 'failed' releases the domain for re-registration on the spot,
-- while KEEPING the row visible to the reaper, which then deletes the
-- agent + voice config + knowledge domain + chunks on its next run and
-- sets 'expired' itself. Immediate unblock, no orphaned assets, no
-- manual asset deletion, no cron secret.
--
-- (Do NOT reach for status 'expired' here as a shortcut — it frees the
-- domain too, but drops the row out of the reaper's view permanently
-- and orphans the assets forever. That is the whole reason this file
-- backdates expiresAt instead.)

UPDATE "DemoProspect"
SET status = 'failed',
    "updatedAt" = NOW()
WHERE slug IN ('desert-glow-med-spa-189e3dfc',
               'zz-outbound-integration-test-a3ce25eb')
  AND status IN ('ready', 'provisioning');

-- Confirm the domain is released — this must return zero rows, which
-- is what the POST route's live-demo lookup checks before reusing a slug:
SELECT slug, status FROM "DemoProspect"
WHERE "websiteDomain" = 'desertglow.com'
  AND status NOT IN ('expired', 'claimed', 'failed');

-- The prospecting tool's next POST for desertglow.com now creates a
-- FRESH prospect with the corrected 'med-spa' vertical and persona.
-- The reaper retires the old row's assets on its next scheduled run;
-- nothing further is needed by hand.
-- ─────────────────────────────────────────────────────────────────────
