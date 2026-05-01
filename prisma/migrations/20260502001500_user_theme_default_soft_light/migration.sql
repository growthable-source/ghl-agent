-- Default new users to the light theme. Existing users keep whatever
-- they previously chose; this only changes the default for rows that
-- don't supply a value at insert time.
ALTER TABLE "User" ALTER COLUMN "theme" SET DEFAULT 'soft-light';
