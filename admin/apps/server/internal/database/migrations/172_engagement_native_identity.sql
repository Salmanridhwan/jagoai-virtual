ALTER TABLE engagement_items ADD COLUMN native_remote_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS engagement_items_native_identity_idx
  ON engagement_items (social_account_id, platform, native_remote_id);
