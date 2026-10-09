-- A personal background for your Chats screen, bought with coins. Only you see it.
ALTER TABLE profile_images DROP CONSTRAINT IF EXISTS profile_images_kind_check;
ALTER TABLE profile_images ADD CONSTRAINT profile_images_kind_check CHECK (kind IN ('avatar', 'cover', 'chats_bg'));
ALTER TABLE users ADD COLUMN chats_bg_image_id BIGINT REFERENCES profile_images(id) ON DELETE SET NULL;
