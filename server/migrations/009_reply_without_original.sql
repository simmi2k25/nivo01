-- Originals are deleted once delivered, so a reply must be able to point at a message the server no
-- longer has. Devices resolve the quote from their own copy.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_reply_to_id_fkey;
