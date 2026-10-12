-- UNO tables: friends bet coins, play in real time, and the winner takes the pot.
-- The game itself lives in memory; these rows hold the money so a restart can refund it.
CREATE TABLE uno_tables (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  host_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  min_bet         INT NOT NULL CHECK (min_bet BETWEEN 1 AND 100),
  max_bet         INT NOT NULL CHECK (max_bet BETWEEN 1 AND 100 AND max_bet >= min_bet),
  status          TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','finished','closed')),
  winner_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  pot             INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX uno_tables_open_idx ON uno_tables (status) WHERE status IN ('lobby','playing');

-- One row per seated player. `settled` flips once the bet is paid out or refunded.
CREATE TABLE uno_seats (
  table_id   BIGINT NOT NULL REFERENCES uno_tables(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet        INT NOT NULL CHECK (bet BETWEEN 1 AND 100),
  settled    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, user_id)
);
