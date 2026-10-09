-- Admins can post announcements that everyone sees. The official @nivotalk account is the first admin.
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET is_admin = true WHERE username = 'nivotalk';

CREATE TABLE announcements (
  id         BIGSERIAL PRIMARY KEY,
  author_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX announcements_recent_idx ON announcements (id DESC);
