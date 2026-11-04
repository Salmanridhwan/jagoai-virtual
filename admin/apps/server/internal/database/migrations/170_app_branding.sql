CREATE TABLE IF NOT EXISTS app_branding_profiles (
  scope_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  profile_json TEXT NOT NULL,
  allow_workspace_override BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CHECK (revision > 0),
  CHECK (scope_id <> '' AND profile_json <> '')
);
CREATE INDEX IF NOT EXISTS app_branding_profiles_org_idx ON app_branding_profiles (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS app_branding_profiles_default_idx ON app_branding_profiles (organization_id) WHERE workspace_id IS NULL;
