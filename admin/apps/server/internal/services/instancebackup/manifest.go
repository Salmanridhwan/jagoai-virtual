package instancebackup

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	FormatVersion = 1

	manifestEntry = "manifest.json"
	databaseEntry = "database/openpost.db"
	mediaPrefix   = "media/"

	pendingDirName     = "restore-pending"
	pendingMarkerName  = "pending.json"
	pendingUploadName  = "upload.zip"
	restorePointPrefix = "pre-restore-"
)

var restorePointNamePattern = regexp.MustCompile(`^pre-restore-\d{8}T\d{6}Z$`)

type Manifest struct {
	FormatVersion            int       `json:"format_version"`
	CreatedAt                time.Time `json:"created_at"`
	AppVersion               string    `json:"app_version"`
	DatabaseDriver           string    `json:"database_driver"`
	StorageDriver            string    `json:"storage_driver"`
	SchemaVersion            int64     `json:"schema_version"`
	DatabaseBytes            int64     `json:"database_bytes"`
	DatabaseSHA256           string    `json:"database_sha256"`
	MediaFiles               int       `json:"media_files"`
	MediaBytes               int64     `json:"media_bytes"`
	EncryptionKeyFingerprint string    `json:"encryption_key_fingerprint"`
}

type Paths struct {
	DatabaseFile string
	MediaDir     string
}

func (p Paths) dataDir() string {
	return filepath.Dir(p.DatabaseFile)
}

func (p Paths) PendingDir() string {
	return filepath.Join(p.dataDir(), pendingDirName)
}

type Current struct {
	DatabaseDriver           string
	StorageDriver            string
	SchemaVersion            int64
	EncryptionKeyFingerprint string
}

func KeyFingerprint(key string) string {
	if key == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("openpost-backup-key:" + key))
	return hex.EncodeToString(sum[:8])
}

// Validate rejects overlapping paths that would let replacing media remove the
// live database, staged input, recovery copies, or export workspace.
func (p Paths) Validate() error {
	database, err := filepath.Abs(p.DatabaseFile)
	if err != nil || p.DatabaseFile == "" {
		return fmt.Errorf("backup requires a database file")
	}
	media, err := filepath.Abs(p.MediaDir)
	if err != nil || p.MediaDir == "" {
		return fmt.Errorf("backup requires a media directory")
	}
	// Resolve roots and the database file itself, which may be a symlink.
	dataDir := filepath.Dir(database)
	if overlapsBackupDirectory(dataDir, media) {
		return fmt.Errorf("media overlaps backup working directories")
	}
	if resolved, err := filepath.EvalSymlinks(dataDir); err == nil {
		dataDir = resolved
	}
	if resolved, err := filepath.EvalSymlinks(database); err == nil {
		database = resolved
	}
	if resolved, err := filepath.EvalSymlinks(media); err == nil {
		media = resolved
	}
	relative, err := filepath.Rel(media, database)
	if err != nil {
		return err
	}
	if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("the database must be outside the media directory")
	}
	if overlapsBackupDirectory(dataDir, media) {
		return fmt.Errorf("media overlaps backup working directories")
	}
	return nil
}

func overlapsBackupDirectory(dataDir, media string) bool {
	relative, err := filepath.Rel(dataDir, media)
	if err != nil {
		return true
	}
	root := strings.Split(relative, string(filepath.Separator))[0]
	return root == pendingDirName || restorePointNamePattern.MatchString(root) || strings.HasPrefix(root, "backup-export-")
}
