-- 003_add_user_auth_columns.sql
-- Up
ALTER TABLE users
    ADD COLUMN email VARCHAR NULL;

ALTER TABLE users
    ADD COLUMN google_sub VARCHAR NULL;

ALTER TABLE users
    ADD CONSTRAINT uq_users_email UNIQUE (email);

ALTER TABLE users
    ADD CONSTRAINT uq_users_google_sub UNIQUE (google_sub);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub);

-- Down
DROP INDEX IF EXISTS ix_users_google_sub;
DROP INDEX IF EXISTS ix_users_email;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS uq_users_google_sub;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS uq_users_email;

ALTER TABLE users
    DROP COLUMN IF EXISTS google_sub;

ALTER TABLE users
    DROP COLUMN IF EXISTS email;
