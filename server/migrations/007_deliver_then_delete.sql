-- Chats live on people's devices. The server only holds a message until every member's devices have
-- received it, then deletes it (anything older than 30 days is deleted regardless).

-- Edits, deletions and reactions travel as 'op' messages so devices that already stored the original can apply them.
ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('text', 'sticker', 'photo', 'booth_invite', 'system', 'op'));
CREATE INDEX messages_created_idx ON messages (created_at);

-- Each installed app / browser that has synced recently.
CREATE TABLE devices (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices (user_id);

-- How far each device has received each chat.
CREATE TABLE device_cursors (
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  delivered_id    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, conversation_id)
);
