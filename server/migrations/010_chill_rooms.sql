-- Chill Rooms: friends listen to the same full-length songs in sync and chat while they play.
CREATE TABLE chill_rooms (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  host_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  -- queue, play position and the room chat, saved so a server restart doesn't lose the room
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX chill_rooms_conversation_idx ON chill_rooms (conversation_id) WHERE status = 'open';

-- Which YouTube video plays a given Apple Music track (YouTube searches are rationed by quota).
CREATE TABLE song_videos (
  track_key   TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL,
  duration_ms INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
