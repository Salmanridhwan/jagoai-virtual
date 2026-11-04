CREATE TABLE IF NOT EXISTS inbox_heads (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inbox_changes (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('conversation','message','engagement')),
  conversation_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  engagement_id TEXT NOT NULL DEFAULT '',
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (workspace_id, revision)
);
CREATE TABLE IF NOT EXISTS inbox_activity (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  view TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  social_account_id TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMP NOT NULL,
  PRIMARY KEY (workspace_id, user_id, client_id)
);
CREATE INDEX IF NOT EXISTS inbox_activity_expiry_idx ON inbox_activity (expires_at, social_account_id);
CREATE TABLE IF NOT EXISTS message_operations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES direct_messages(id),
  PRIMARY KEY (workspace_id, user_id, conversation_id, operation_id)
);
CREATE TABLE IF NOT EXISTS message_event_checkpoints (
  social_account_id TEXT PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
  cursor TEXT NOT NULL DEFAULT '',
  bootstrap_cursor TEXT NOT NULL DEFAULT '',
  initialized BOOLEAN NOT NULL DEFAULT FALSE,
  history_cursor TEXT NOT NULL DEFAULT '',
  history_complete BOOLEAN NOT NULL DEFAULT FALSE,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TIMESTAMP,
  next_poll_at TIMESTAMP,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  actor_remote_id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (message_id, actor_remote_id, value)
);
ALTER TABLE direct_messages ADD COLUMN client_operation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE direct_messages ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE direct_messages ADD COLUMN provider_read_at TIMESTAMP;
CREATE TABLE IF NOT EXISTS message_history_checkpoints (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  cursor TEXT NOT NULL DEFAULT '',
  complete BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS engagement_operations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES engagement_items(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  job_id TEXT NOT NULL, -- Keep the replay receipt if job history is pruned.
  PRIMARY KEY(workspace_id,user_id,item_id,operation_id)
);
