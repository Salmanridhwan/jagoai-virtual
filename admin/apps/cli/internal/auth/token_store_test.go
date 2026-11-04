package auth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCredentialRewriteRepairsPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(path, []byte(`{"profiles":{"default":"old"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if err := NewInsecureStore(path).Set("default", "new-secret"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("credential permissions=%o, want0600", info.Mode().Perm())
	}
	token, err := NewInsecureStore(path).Get("default")
	if err != nil || token != "new-secret" {
		t.Fatalf("token read=%q %v", token, err)
	}
}

func TestEmptyFileCredentialDoesNotSelectFileStorage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(path, []byte(`{"profiles":{"default":"  "}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if hasFileToken(path, "default") {
		t.Fatal("empty credentials must not hide keyring token")
	}
}
