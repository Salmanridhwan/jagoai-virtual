-- Supplemental X messaging credentials never replace OAuth1 publishing grants.
CREATE TABLE x_messaging_grants (
  social_account_id TEXT PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  remote_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  access_token_encrypted BYTEA NOT NULL,
  refresh_token_encrypted BYTEA,
  scopes TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  refresh_lease_until TIMESTAMP,
  invalid BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX x_messaging_grants_workspace_idx ON x_messaging_grants(workspace_id);
CREATE TABLE x_messaging_auth_requests (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  verifier_encrypted BYTEA NOT NULL,
  expires_at TIMESTAMP NOT NULL
);
CREATE INDEX x_messaging_auth_requests_expiry_idx ON x_messaging_auth_requests(expires_at);
CREATE INDEX x_messaging_auth_requests_user_idx ON x_messaging_auth_requests(user_id);
CREATE INDEX x_messaging_auth_requests_workspace_idx ON x_messaging_auth_requests(workspace_id);
CREATE INDEX x_messaging_auth_requests_account_idx ON x_messaging_auth_requests(social_account_id);
-- One bounded rolling request log per remote user and endpoint. Atomic reservations
-- include failed/ambiguous requests; application restarts cannot reset quotas.
CREATE TABLE x_messaging_quota_windows (
  remote_user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  requests_json TEXT NOT NULL DEFAULT '[]',
  blocked_until TIMESTAMP,
  PRIMARY KEY (remote_user_id, operation)
);
CREATE TABLE x_messaging_subscriptions (
  id TEXT PRIMARY KEY,
  social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  remote_user_id TEXT NOT NULL,
  remote_subscription_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL CHECK (event_type IN ('dm.received', 'dm.sent')),
  event_limit INTEGER NOT NULL CHECK (event_limit BETWEEN 1 AND 100),
  received INTEGER NOT NULL DEFAULT 0,
  last_stop_attempt_at TIMESTAMP,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'unknown', 'stopped')),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX x_messaging_subscriptions_account_idx ON x_messaging_subscriptions(social_account_id, state);
CREATE INDEX x_messaging_subscriptions_workspace_idx ON x_messaging_subscriptions(workspace_id);
CREATE UNIQUE INDEX x_messaging_subscriptions_live_idx ON x_messaging_subscriptions(remote_user_id, event_type) WHERE state != 'stopped';
CREATE TABLE x_messaging_receipts (
  event_uuid TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES x_messaging_subscriptions(id) ON DELETE CASCADE,
  social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  payload_encrypted BYTEA NOT NULL,
  cost_operation_key TEXT NOT NULL DEFAULT '',
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX x_messaging_receipts_pending_idx ON x_messaging_receipts(processed, attempts, next_attempt_at, created_at);
CREATE INDEX x_messaging_receipts_subscription_idx ON x_messaging_receipts(subscription_id);
CREATE INDEX x_messaging_receipts_account_idx ON x_messaging_receipts(social_account_id);
