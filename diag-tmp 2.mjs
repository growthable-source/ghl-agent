import { readFileSync } from 'fs'
import pg from 'pg'
const env = readFileSync('.env.local','utf8')
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'')
const c = new pg.Client({ connectionString: get('POSTGRES_PRISMA_URL')||get('POSTGRES_URL')||get('DATABASE_URL'), ssl:{rejectUnauthorized:false} })
await c.connect()

const r = await c.query(`
  SELECT s.id, s."sourceType", s."urlOrIdentifier", s."isActive", s."lastCrawledAt",
         s."crawlConfig",
         (SELECT COUNT(*)::int FROM "KnowledgeChunk" k WHERE k."sourceId"=s.id AND k."supersededAt" IS NULL) AS chunks,
         run.status, run."pagesAttempted", run."pagesSucceeded", run."startedAt",
         jsonb_array_length(COALESCE(run."errorLog",'[]'::jsonb)) AS errors
  FROM "KnowledgeSource" s
  LEFT JOIN LATERAL (
    SELECT * FROM "IngestionRun" ir WHERE ir."sourceId"=s.id ORDER BY ir."startedAt" DESC LIMIT 1
  ) run ON TRUE
  ORDER BY s."createdAt" DESC`)
console.log('\n=== ALL SOURCES ===')
for (const x of r.rows) {
  console.log(`\n[${x.status ?? 'no run'}] ${x.sourceType}  chunks=${x.chunks}  pages=${x.pagesSucceeded}/${x.pagesAttempted}  errs=${x.errors}`)
  console.log(`   ${x.urlOrIdentifier}`)
  console.log(`   id=${x.id} active=${x.isActive} cfg=${JSON.stringify(x.crawlConfig)}`)
}

const e = await c.query(`
  SELECT s."urlOrIdentifier", ir."errorLog"
  FROM "IngestionRun" ir JOIN "KnowledgeSource" s ON s.id=ir."sourceId"
  WHERE ir.status IN ('failed','partial')
  ORDER BY ir."startedAt" DESC LIMIT 6`)
console.log('\n\n=== ERROR LOG SAMPLES ===')
for (const x of e.rows) {
  const log = Array.isArray(x.errorLog) ? x.errorLog : []
  console.log(`\n--- ${x.urlOrIdentifier}  (${log.length} errors)`)
  for (const item of log.slice(0,4)) console.log('   ', JSON.stringify(item).slice(0,400))
}
await c.end()
