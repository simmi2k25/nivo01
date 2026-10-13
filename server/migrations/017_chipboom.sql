-- Chip or Boom: two friends, a blue and a pink grid, both put in the same stake and the winner takes the pot.
-- The game itself lives in memory; these rows hold the money so a restart can refund it.
CREATE TABLE cb_tables (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  host_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  stake           INT NOT NULL CHECK (stake BETWEEN 1 AND 100),
  status          TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','finished','closed')),
  winner_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  pot             INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX cb_tables_open_idx ON cb_tables (status) WHERE status IN ('lobby','playing');

-- A row once a player taps Ready and their stake is taken. `settled` flips once it's paid out or refunded.
CREATE TABLE cb_seats (
  table_id   BIGINT NOT NULL REFERENCES cb_tables(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side       TEXT NOT NULL CHECK (side IN ('blue','pink')),
  bet        INT NOT NULL CHECK (bet BETWEEN 1 AND 100),
  settled    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, user_id)
);
