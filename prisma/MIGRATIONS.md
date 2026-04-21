# Database migrations

This project uses Prisma's managed migrations. Schema changes are
tracked as numbered folders under `prisma/migrations/`, and the
Vercel build applies them automatically on every deploy — no more
pasting SQL into the DB console.

## How to change the schema

Edit `prisma/schema.prisma`, then from your local machine:

```bash
# Generates a new migration folder under prisma/migrations/
# with a timestamp + your description. Applies it to your local DB.
npm run db:migrate -- --name describe_your_change
```

Commit the new migration folder. On the next Vercel deploy,
`prisma migrate deploy` runs it automatically against production.

## How the build applies migrations

`package.json`'s `build` script runs `scripts/prisma-migrate.mjs`
before `next build`. That script:

1. Checks whether `_prisma_migrations` exists in the DB.
   - **First deploy** (state table missing): marks every migration
     already committed as `applied` — since the schema was built by
     hand before we switched to Prisma migrations, the DB rows
     already exist and we don't want to re-run DDL. This happens
     exactly once.
   - **Subsequent deploys** (state table present): skips the
     bootstrap step.
2. Runs `npx prisma migrate deploy`, which applies any migrations
   in `prisma/migrations/` that aren't recorded as applied yet.

If migrations fail, the build fails. That's deliberate — we don't
want a deploy to go out with an app expecting schema that isn't there.

## The baseline migration

`20260101000000_baseline/migration.sql` represents the entire schema
as of the date we switched to Prisma migrations. It's never run
against production (marked as applied by the bootstrap step) but
serves as the reference for future `prisma migrate diff` operations
and for local-dev database recreation.

## Old flat-file migrations

Every `manual_*.sql` and `add_*.sql` file that used to live in
`prisma/migrations/` now lives in `prisma/migrations-legacy/` for
historical reference. They've already been applied to production by
hand; they're not executed anymore. Keep them around — they're
useful when someone asks "when did we add field X?"

## Common gotchas

- **Don't edit a migration after it's committed to main.** Prisma
  checksums each file; editing one makes it look tampered and the
  next deploy refuses to run. Create a new migration to fix
  something instead.
- **Local schema drift?** Run `npx prisma migrate dev` and it'll
  regenerate the local DB from scratch. Your local data is wiped —
  that's what `migrate dev` does, unlike `migrate deploy` which is
  non-destructive.
- **Need to mark a migration as applied without running it?**
  `npx prisma migrate resolve --applied <migration_name>`. Useful
  if you've fixed something by hand in a pinch.
- **Enum changes?** Prisma's auto-generated SQL for
  `ADD VALUE` doesn't have `IF NOT EXISTS`, but Postgres adds
  it silently if the value already exists. Safe.
