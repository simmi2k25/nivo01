CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._]{3,20}$'),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  status_message TEXT NOT NULL DEFAULT '',
  avatar         TEXT NOT NULL DEFAULT 'dino',
  theme_color    TEXT NOT NULL DEFAULT 'periwinkle',
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE friendships (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  favorite   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
CREATE INDEX friendships_friend_idx ON friendships (friend_id);

CREATE TABLE conversations (
  id         BIGSERIAL PRIMARY KEY,
  is_group   BOOLEAN NOT NULL DEFAULT false,
  title      TEXT,
  direct_key TEXT UNIQUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  muted           BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('text','sticker','photo','booth_invite','system')),
  body            TEXT NOT NULL DEFAULT '',
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, id);
CREATE INDEX messages_photo_idx ON messages ((meta->>'photoId')) WHERE kind = 'photo';

CREATE TABLE booth_rooms (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  host_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  shots           INT NOT NULL DEFAULT 4 CHECK (shots BETWEEN 1 AND 6),
  countdown       INT NOT NULL DEFAULT 3 CHECK (countdown BETWEEN 1 AND 10),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE TABLE photos (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_code  TEXT,
  mime       TEXT NOT NULL,
  size       INT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX photos_owner_idx ON photos (owner_id, created_at DESC);
