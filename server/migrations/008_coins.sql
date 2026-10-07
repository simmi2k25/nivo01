-- Coins: a balance per person, a ledger of every change, and what coins unlock.
ALTER TABLE users
  ADD COLUMN coins        INT NOT NULL DEFAULT 10 CHECK (coins >= 0),  -- 10 welcome coins
  ADD COLUMN memory_slots INT NOT NULL DEFAULT 5;

CREATE TABLE coin_ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta      INT NOT NULL,
  reason     TEXT NOT NULL,          -- welcome, purchase, gift_sent, gift_received, memory, wallpaper, group_create, group_join
  ref        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX coin_ledger_user_idx ON coin_ledger (user_id, id DESC);
INSERT INTO coin_ledger (user_id, delta, reason) SELECT id, 10, 'welcome' FROM users;

-- A chat background shared by everyone in the chat (one per chat; replacing it deletes the old one).
CREATE TABLE chat_wallpapers (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  set_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  mime            TEXT NOT NULL,
  data            BYTEA NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE conversations ADD COLUMN wallpaper_id BIGINT REFERENCES chat_wallpapers(id) ON DELETE SET NULL;

-- Group invitations: invited people join by spending a coin, or decline.
CREATE TABLE group_invites (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX group_invites_user_idx ON group_invites (user_id);

-- Photobooths where someone paid to remove the NivoTalk wordmark from their strips.
CREATE TABLE booth_unlocks (
  room_code  TEXT NOT NULL,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_code, user_id)
);
