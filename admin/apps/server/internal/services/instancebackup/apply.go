package instancebackup

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type RestorePoint struct {
	Name      string
	CreatedAt time.Time
	Bytes     int64
}

// ApplyPending runs before opening SQLite or starting workers. Staged inputs and
// the recovery copy remain immutable until commit. A durable journal makes an
// interrupted installation roll back on the next start, without guessing which
// database or media files were already replaced.
func ApplyPending(paths Paths, current Current, now time.Time) (bool, error) {
	pending, err := ReadPending(paths)
	if err != nil {
		return false, fmt.Errorf("read staged restore: %w", err)
	}
	if pending == nil {
		return false, nil
	}
	if err := paths.Validate(); err != nil {
		return false, err
	}
	journal := filepath.Join(paths.PendingDir(), "applying.json")
	raw, err := os.ReadFile(journal)
	if err == nil {
		var point string
		if err := json.Unmarshal(raw, &point); err != nil || !restorePointNamePattern.MatchString(point) {
			return false, errors.New("invalid restore recovery journal")
		}
		if err := recoverPrevious(paths, point, pending); err != nil {
			return false, err
		}
		log.Printf("Recovered the previous data after an interrupted restore; staged backup requires confirmation again")
		return false, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	if !pending.Confirmed {
		return false, nil
	}

	if err := checkCompatible(pending.Manifest, current); err != nil {
		return false, err
	}
	return applyConfirmed(paths, pending, now)
}

func applyConfirmed(paths Paths, pending *Pending, now time.Time) (bool, error) {
	journal := filepath.Join(paths.PendingDir(), "applying.json")
	name := restorePointPrefix + now.UTC().Format("20060102T150405Z")
	point := filepath.Join(paths.dataDir(), name)
	// Never merge into or overwrite an existing recovery copy.
	if err := os.Mkdir(point, 0o700); err != nil {
		return false, err
	}
	if err := copyCurrent(paths, point); err != nil {
		_ = os.RemoveAll(point)
		return false, fmt.Errorf("save previous data: %w", err)
	}
	raw, _ := json.Marshal(name)
	if err := writeAtomic(journal, raw); err != nil {
		return false, err
	}
	if err := replaceData(paths, filepath.Join(paths.PendingDir(), filepath.FromSlash(databaseEntry)), filepath.Join(paths.PendingDir(), "media")); err != nil {
		if recoveryErr := recoverPrevious(paths, name, pending); recoveryErr != nil {
			return false, fmt.Errorf("restore failed: %w; recovery incomplete, previous data is in %s: %w", err, point, recoveryErr)
		}
		return false, fmt.Errorf("restore failed; previous data recovered: %w", err)
	}
	// Removing the staged marker commits the restore. A leftover journal is then
	// harmless, even if cleanup is interrupted.
	if err := os.Remove(filepath.Join(paths.PendingDir(), pendingMarkerName)); err != nil {
		return false, err
	}
	if err := syncDirectory(paths.PendingDir()); err != nil {
		return false, err
	}
	if err := os.RemoveAll(paths.PendingDir()); err != nil {
		log.Printf("restore applied but staging cleanup failed: %v", err)
	}
	return true, nil
}

func copyCurrent(paths Paths, point string) error {
	for _, suffix := range []string{"", "-wal", "-shm"} {
		source := paths.DatabaseFile + suffix
		if _, err := os.Stat(source); errors.Is(err, fs.ErrNotExist) && suffix != "" {
			continue
		} else if err != nil {
			return err
		}
		if err := copyTree(source, filepath.Join(point, "database"+suffix)); err != nil {
			return err
		}
	}
	if err := copyOptionalTree(paths.MediaDir, filepath.Join(point, "media")); err != nil {
		return err
	}
	return syncTreeDirectories(point)
}

func recoverPrevious(paths Paths, name string, pending *Pending) error {
	point := filepath.Join(paths.dataDir(), name)
	if err := replaceData(paths, filepath.Join(point, "database"), filepath.Join(point, "media")); err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		source := filepath.Join(point, "database"+suffix)
		if _, err := os.Stat(source); errors.Is(err, fs.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		if err := copyTree(source, paths.DatabaseFile+suffix); err != nil {
			return err
		}
	}
	if err := writePending(paths, pendingMarker{Manifest: pending.Manifest, StagedAt: pending.StagedAt}); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(paths.PendingDir(), "applying.json")); err != nil {
		return err
	}
	if err := syncDirectory(paths.PendingDir()); err != nil {
		return err
	}
	// Keep the complete recovery copy for inspection and manual recovery.
	return nil
}

func replaceData(paths Paths, databaseSource, mediaSource string) error {
	// Check the source before touching current data.
	if _, err := os.Stat(databaseSource); err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if err := os.Remove(paths.DatabaseFile + suffix); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	if err := copyTree(databaseSource, paths.DatabaseFile); err != nil {
		return err
	}
	if paths.MediaDir == "" {
		return nil
	}
	// Preserve the configured root, which may be a mounted volume.
	if err := os.MkdirAll(paths.MediaDir, 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(paths.MediaDir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(paths.MediaDir, entry.Name())); err != nil {
			return err
		}
	}
	if err := copyOptionalTree(mediaSource, paths.MediaDir); err != nil {
		return err
	}
	return syncTreeDirectories(paths.MediaDir)
}

func copyOptionalTree(source, destination string) error {
	if source == "" {
		return nil
	}
	if _, err := os.Stat(source); errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return copyTree(source, destination)
}

func copyTree(source, destination string) error {
	// Follow the configured root once; preserve symlink entries inside the tree.
	// In particular a symlinked media mount must yield independent snapshot bytes.
	resolved, err := filepath.EvalSymlinks(source)
	if err != nil {
		return err
	}
	source = resolved
	err = filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("cannot copy %s: unsupported file type", path)
		}
		return copyRegularFile(path, target)
	})
	if err != nil {
		return err
	}
	return syncTreeDirectories(destination)
}

func copyRegularFile(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.CreateTemp(filepath.Dir(target), ".restore-*")
	if err != nil {
		return err
	}
	defer os.Remove(out.Name())
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if err := os.Rename(out.Name(), target); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(target))
}

// Sync children before their parents, including the entry for the root itself,
// before publishing a journal that promises the recovery copy is complete.
func syncTreeDirectories(root string) error {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	root = resolved
	var directories []string
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			directories = append(directories, path)
		}
		return nil
	}); err != nil {
		return err
	}
	for index := len(directories) - 1; index >= 0; index-- {
		if err := syncDirectory(directories[index]); err != nil {
			return err
		}
	}
	return syncDirectory(filepath.Dir(root))
}

func ListRestorePoints(paths Paths) ([]RestorePoint, error) {
	entries, err := os.ReadDir(paths.dataDir())
	if err != nil {
		return nil, err
	}
	var points []RestorePoint
	for _, entry := range entries {
		if !entry.IsDir() || !restorePointNamePattern.MatchString(entry.Name()) {
			continue
		}
		createdAt, err := time.Parse("20060102T150405Z", entry.Name()[len(restorePointPrefix):])
		if err != nil {
			continue
		}
		points = append(points, RestorePoint{
			Name:      entry.Name(),
			CreatedAt: createdAt,
			Bytes:     directorySize(filepath.Join(paths.dataDir(), entry.Name())),
		})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].CreatedAt.After(points[j].CreatedAt) })
	return points, nil
}

func DeleteRestorePoint(paths Paths, name string) error {
	if !restorePointNamePattern.MatchString(name) {
		return fs.ErrNotExist
	}
	target := filepath.Join(paths.dataDir(), name)
	if _, err := os.Stat(target); err != nil {
		return err
	}
	return os.RemoveAll(target)
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.Type().IsRegular() {
			return nil
		}
		if info, infoErr := entry.Info(); infoErr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}
