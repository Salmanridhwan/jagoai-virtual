ALTER TABLE publications ADD COLUMN review_id TEXT NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN review_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN review_state TEXT NOT NULL DEFAULT '';

CREATE TABLE publication_reviews (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL,
 reviewer_id TEXT NOT NULL,
 epoch INTEGER NOT NULL,
 includes_schedule BOOLEAN NOT NULL,
 snapshot_json TEXT NOT NULL,
 fingerprints_json TEXT NOT NULL,
 note TEXT NOT NULL,
 decision TEXT NOT NULL DEFAULT '',
 feedback TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMP NOT NULL,
 decided_at TIMESTAMP,
 UNIQUE(publication_id, epoch)
);
CREATE INDEX publication_reviews_reviewer ON publication_reviews(workspace_id, reviewer_id, created_at);
