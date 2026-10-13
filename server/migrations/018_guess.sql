-- Guess the Number: 2–4 friends each hide a number, crack each other's, fewest tries takes the pot.
-- The game itself lives in memory; these rows hold the money so a restart can refund it.
CREATE TABLE gn_tables (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  host_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  stake           INT NOT NULL CHECK (stake BETWEEN 1 AND 100),
  max_number      INT NOT NULL CHECK (max_number IN (50, 100, 1000)),
  status          TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','finished','closed')),
  winner_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  pot             INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX gn_tables_open_idx ON gn_tables (status) WHERE status IN ('lobby','playing');

-- A row once a player taps Ready and their stake is taken. `settled` flips once it's paid out or refunded.
CREATE TABLE gn_seats (
  table_id   BIGINT NOT NULL REFERENCES gn_tables(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet        INT NOT NULL CHECK (bet BETWEEN 1 AND 100),
  settled    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, user_id)
);
