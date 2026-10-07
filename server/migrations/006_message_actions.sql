-- Editing, deleting (for everyone) and replying to messages, plus emoji reactions.
ALTER TABLE messages
  ADD COLUMN edited_at   TIMESTAMPTZ,
  ADD COLUMN deleted_at  TIMESTAMPTZ,
  ADD COLUMN reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL;

-- One reaction per person per message; reacting again swaps the emoji.
CREATE TABLE message_reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
