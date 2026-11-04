CREATE TABLE monthly_usage_reservations (
 operation_key TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 metric TEXT NOT NULL,
 period_start TIMESTAMP NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('held', 'committed', 'released')),
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_monthly_usage_reservations_workspace ON monthly_usage_reservations (workspace_id, metric, period_start);
