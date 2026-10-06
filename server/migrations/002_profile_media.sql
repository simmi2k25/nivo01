CREATE TABLE profile_images (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('avatar','cover')),
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN avatar_image_id BIGINT REFERENCES profile_images(id) ON DELETE SET NULL,
  ADD COLUMN cover_image_id  BIGINT REFERENCES profile_images(id) ON DELETE SET NULL;
