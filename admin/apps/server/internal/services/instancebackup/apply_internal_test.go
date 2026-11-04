package instancebackup

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestApplyPendingRecoversInterruptedInstall(t *testing.T) {
	root := t.TempDir()
	paths := Paths{DatabaseFile: filepath.Join(root, "db", "openpost.db"), MediaDir: filepath.Join(root, "media")}
	point := "pre-restore-20261024T120000Z"
	// Persisted state after the recovery snapshot completed, followed by a crash
	// during replacement. Recovery must use the original point, not save this
	// partially installed state as the previous instance.
	writeTestFile(t, paths.DatabaseFile, "partially-installed-db")
	writeTestFile(t, filepath.Join(paths.MediaDir, "new.png"), "partial-media")
	writeTestFile(t, filepath.Join(paths.dataDir(), point, "database"), "original-db")
	writeTestFile(t, filepath.Join(paths.dataDir(), point, "media", "old.png"), "original-media")
	writeTestFile(t, filepath.Join(paths.PendingDir(), filepath.FromSlash(databaseEntry)), "staged-db")
	writeTestFile(t, filepath.Join(paths.PendingDir(), pendingMarkerName), `{"manifest":{"format_version":1},"confirmed":true}`)
	writeTestFile(t, filepath.Join(paths.PendingDir(), "applying.json"), `"`+point+`"`)
	applied, err := ApplyPending(paths, Current{}, time.Now())
	if err != nil || applied {
		t.Fatalf("applied = %v, err = %v", applied, err)
	}
	assertTestFile(t, paths.DatabaseFile, "original-db")
	assertTestFile(t, filepath.Join(paths.MediaDir, "old.png"), "original-media")
	if _, err := os.Stat(filepath.Join(paths.MediaDir, "new.png")); !os.IsNotExist(err) {
		t.Fatalf("partially installed media survived: %v", err)
	}
	pending, err := ReadPending(paths)
	if err != nil || pending == nil || pending.Confirmed {
		t.Fatalf("pending = %v, err = %v", pending, err)
	}
	assertTestFile(t, filepath.Join(paths.PendingDir(), filepath.FromSlash(databaseEntry)), "staged-db")
	// A second ordinary start cannot reapply the unconfirmed backup.
	if applied, err := ApplyPending(paths, Current{}, time.Now()); err != nil || applied {
		t.Fatalf("second start = %v, %v", applied, err)
	}
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertTestFile(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || string(got) != want {
		t.Fatalf("%s = %q, err = %v; want %q", path, got, err, want)
	}
}

func TestCopyTreeKeepsSymlinks(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	writeTestFile(t, filepath.Join(source, "photo.png"), "photo")
	if err := os.Symlink("photo.png", filepath.Join(source, "alias.png")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	destination := filepath.Join(root, "destination")
	if err := copyTree(source, destination); err != nil {
		t.Fatal(err)
	}
	link, err := os.Readlink(filepath.Join(destination, "alias.png"))
	if err != nil || link != "photo.png" {
		t.Fatalf("link = %q, err = %v", link, err)
	}
	assertTestFile(t, filepath.Join(destination, "photo.png"), "photo")
}
