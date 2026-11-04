package instancebackup

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/uptrace/bun"
)

type ExportOptions struct {
	AppVersion               string
	DatabaseDriver           string
	StorageDriver            string
	EncryptionKeyFingerprint string
	MediaSnapshotMu          *sync.RWMutex
	Paths                    Paths
	Now                      func() time.Time
}

func WriteArchive(ctx context.Context, db *bun.DB, options ExportOptions, output io.Writer) (Manifest, error) {
	if err := options.Paths.Validate(); err != nil {
		return Manifest{}, err
	}
	snapshotDir, err := os.MkdirTemp(options.Paths.dataDir(), "backup-export-")
	if err != nil {
		return Manifest{}, fmt.Errorf("create backup workspace: %w", err)
	}
	defer os.RemoveAll(snapshotDir)

	// Local storage publishes immutable files by rename. Holding this gate
	// until private copies exist prevents deletion or replacement of blobs
	// referenced by the database snapshot, without blocking a slow download.
	if options.MediaSnapshotMu != nil {
		options.MediaSnapshotMu.Lock()
	}
	locked := options.MediaSnapshotMu != nil
	defer func() {
		if locked {
			options.MediaSnapshotMu.Unlock()
		}
	}()
	snapshotPath := filepath.Join(snapshotDir, "openpost.db")
	if _, err := db.ExecContext(ctx, "VACUUM INTO ?", snapshotPath); err != nil {
		return Manifest{}, fmt.Errorf("snapshot database: %w", err)
	}

	var schemaVersion sql.NullInt64
	if err := db.NewRaw("SELECT MAX(version) FROM schema_migrations").Scan(ctx, &schemaVersion); err != nil {
		return Manifest{}, fmt.Errorf("read schema version: %w", err)
	}

	mediaSnapshot := filepath.Join(snapshotDir, "media")
	if err := copyOptionalTree(options.Paths.MediaDir, mediaSnapshot); err != nil {
		return Manifest{}, fmt.Errorf("snapshot media: %w", err)
	}
	if locked {
		options.MediaSnapshotMu.Unlock()
		locked = false
	}
	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	manifest := Manifest{
		FormatVersion:            FormatVersion,
		CreatedAt:                now().UTC(),
		AppVersion:               options.AppVersion,
		DatabaseDriver:           options.DatabaseDriver,
		StorageDriver:            options.StorageDriver,
		SchemaVersion:            schemaVersion.Int64,
		EncryptionKeyFingerprint: options.EncryptionKeyFingerprint,
	}

	archive := zip.NewWriter(output)
	if err := writeDatabaseEntry(archive, snapshotPath, &manifest); err != nil {
		return Manifest{}, err
	}
	if err := writeMediaEntries(ctx, archive, mediaSnapshot, &manifest); err != nil {
		return Manifest{}, err
	}
	manifestWriter, err := archive.CreateHeader(&zip.FileHeader{Name: manifestEntry, Method: zip.Deflate, Modified: manifest.CreatedAt})
	if err != nil {
		return Manifest{}, err
	}
	if err := json.NewEncoder(manifestWriter).Encode(manifest); err != nil {
		return Manifest{}, err
	}
	if err := archive.Close(); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func writeDatabaseEntry(archive *zip.Writer, snapshotPath string, manifest *Manifest) error {
	file, err := os.Open(snapshotPath)
	if err != nil {
		return fmt.Errorf("open database snapshot: %w", err)
	}
	defer file.Close()

	writer, err := archive.CreateHeader(&zip.FileHeader{Name: databaseEntry, Method: zip.Deflate, Modified: manifest.CreatedAt})
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(writer, hash), file)
	if err != nil {
		return fmt.Errorf("write database snapshot: %w", err)
	}
	manifest.DatabaseBytes = size
	manifest.DatabaseSHA256 = hex.EncodeToString(hash.Sum(nil))
	return nil
}

func writeMediaEntries(ctx context.Context, archive *zip.Writer, mediaDir string, manifest *Manifest) error {
	if mediaDir == "" {
		return nil
	}
	err := filepath.WalkDir(mediaDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, fs.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported media file type: %s", path)
		}
		relative, err := filepath.Rel(mediaDir, path)
		if err != nil {
			return err
		}
		size, err := copyFileIntoArchive(archive, path, mediaPrefix+filepath.ToSlash(relative))

		if err != nil {
			return err
		}
		manifest.MediaFiles++
		manifest.MediaBytes += size
		return nil
	})
	if err != nil {
		return fmt.Errorf("write media files: %w", err)
	}
	return nil
}

func copyFileIntoArchive(archive *zip.Writer, path, name string) (int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return 0, err
	}
	writer, err := archive.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: info.ModTime()})
	if err != nil {
		return 0, err
	}
	return io.Copy(writer, file)
}
