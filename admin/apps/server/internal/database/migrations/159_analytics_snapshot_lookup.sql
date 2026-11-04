CREATE INDEX IF NOT EXISTS analytics_rendition_snapshots_rendition_workspace_captured_idx
  ON analytics_rendition_snapshots (rendition_id, workspace_id, captured_at);
