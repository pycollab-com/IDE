-- 005_add_email_verified.sql
-- Up
ALTER TABLE users
    ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET email_verified = TRUE
WHERE google_sub IS NOT NULL
  AND email IS NOT NULL;

-- Down
ALTER TABLE users
    DROP COLUMN IF EXISTS email_verified;
