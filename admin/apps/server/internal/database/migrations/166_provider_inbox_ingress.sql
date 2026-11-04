-- Provider callbacks are acknowledged only after encrypted receipts commit.
-- Scope receipt identity to the exact account grant, so reconnects cannot
-- replay private events into a replacement authorization.
CREATE TABLE provider_inbox_receipts (
    id TEXT PRIMARY KEY,
    provider_app_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    oauth_grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_encrypted BLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at BIGINT NOT NULL DEFAULT 0,
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until BIGINT NOT NULL DEFAULT 0,
    UNIQUE (provider_app_id, account_id, oauth_grant_id, event_key)
);
CREATE INDEX provider_inbox_receipts_pending_idx
    ON provider_inbox_receipts (next_attempt_at, lease_until, created_at)
    WHERE processed_at IS NULL;
CREATE INDEX provider_inbox_receipts_processed_idx
    ON provider_inbox_receipts (processed_at) WHERE processed_at IS NOT NULL;

CREATE TABLE provider_inbox_transport_leases (
    account_id TEXT PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    expires_at BIGINT NOT NULL
);
CREATE INDEX provider_inbox_receipts_account_idx ON provider_inbox_receipts (account_id);
CREATE INDEX provider_inbox_receipts_grant_idx ON provider_inbox_receipts (oauth_grant_id);
