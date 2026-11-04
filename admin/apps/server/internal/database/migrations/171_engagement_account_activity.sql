ALTER TABLE engagement_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE engagement_items ADD COLUMN subject_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE engagement_items ADD COLUMN review_reply_check_at TIMESTAMP;
ALTER TABLE engagement_items ADD COLUMN review_reply_written_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS engagement_items_account_thread_idx
  ON engagement_items (social_account_id, conversation_remote_id, remote_id);
CREATE INDEX IF NOT EXISTS engagement_items_workspace_kind_idx
  ON engagement_items (workspace_id, kind, archived_at, remote_created_at);
CREATE INDEX IF NOT EXISTS engagement_items_review_recheck_idx
  ON engagement_items (social_account_id, review_reply_check_at) WHERE review_reply_check_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS engagement_account_sync_states (
  social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  feed TEXT NOT NULL CHECK (feed IN ('mentions', 'reviews')),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  generation TEXT NOT NULL,
  grant_id TEXT NOT NULL DEFAULT '',
  grant_consented_at TIMESTAMP,
  feature_decided_at TIMESTAMP,
  cursor TEXT NOT NULL DEFAULT '',
  cycle_started_at TIMESTAMP,
  watermark TIMESTAMP,
  pending_watermark TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  next_sync_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(social_account_id, feed)
);
CREATE INDEX IF NOT EXISTS engagement_account_sync_workspace_idx
  ON engagement_account_sync_states (workspace_id, next_sync_at);

CREATE TABLE IF NOT EXISTS engagement_review_operations (
  item_id TEXT PRIMARY KEY REFERENCES engagement_items(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'complete', 'rejected')),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
