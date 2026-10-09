-- Text statuses: a short styled message friends can see for 24 hours, like a story.
CREATE TABLE statuses (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  style      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { bg, font, size }
  art        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { strokes: pen drawing, stickers: placed stickers }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX statuses_user_idx ON statuses (user_id, expires_at);

CREATE TABLE status_views (
  status_id BIGINT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);
