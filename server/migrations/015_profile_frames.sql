-- Profile frames: decorative rings drawn around someone's photo. Bought once with coins, kept forever.
CREATE TABLE user_frames (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frame_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, frame_id)
);

-- The frame someone is wearing right now (null = none).
ALTER TABLE users ADD COLUMN frame TEXT;
