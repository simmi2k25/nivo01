-- Private rooms: still joinable by link or invite, but never shown in friends' "Live now".
ALTER TABLE chill_rooms ADD COLUMN IF NOT EXISTS private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE booth_rooms ADD COLUMN IF NOT EXISTS private BOOLEAN NOT NULL DEFAULT false;
