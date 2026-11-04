package main

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// The Media Library guide must not restate the server's enforced uploader
// limits by hand: those numbers live in
// apps/server/internal/api/handlers/media.go and are published through the
// generated media-limits guide. See issue #437.
func TestMediaLibraryGuideDerivesUploadLimits(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate test source file")
	}
	guide := filepath.Join(filepath.Dir(file), "..", "..", "..", "docs", "content", "docs", "guides", "media-library.mdx")
	content, err := os.ReadFile(guide)
	if err != nil {
		t.Fatalf("read media library guide: %v", err)
	}
	for _, pattern := range []string{`64\s*million`, `50\s*MB`, `64_?000_?000`, `52428800`} {
		if matched, _ := regexp.MatchString(pattern, string(content)); matched {
			t.Errorf("media library guide restates an enforced upload limit by hand (matched %q); link to /guides/media-limits instead", pattern)
		}
	}
	if !strings.Contains(string(content), "/guides/media-limits") {
		t.Error("media library guide must link to the generated media-limits guide for upload numbers")
	}
}

// The generated media-limits guide must publish the enforced uploader
// limits, read from the server constants, so changing a constant updates
// the guide through the generator. This test parses media.go independently
// of the generator and requires the generated document to carry the same
// numbers: the generator must fail closed rather than print stale values.
func TestGeneratedUploadLimitsMatchServerConstants(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate test source file")
	}
	root := filepath.Join(filepath.Dir(file), "..", "..", "..", "..")
	source, err := os.ReadFile(filepath.Join(root, "apps", "server", "internal", "api", "handlers", "media.go"))
	if err != nil {
		t.Fatalf("read media handler source: %v", err)
	}
	expectBytes := mustConstValue(t, string(source), "MaxBufferedMediaUploadBytes")
	expectPixels := mustConstValue(t, string(source), "mediaUploadMaxImagePixels")

	document, err := generate()
	if err != nil {
		t.Fatalf("generate media limits: %v", err)
	}
	if !strings.Contains(document, "## Upload limits") {
		t.Error("generated media limits must include an Upload limits section")
	}
	for _, want := range []string{
		strings.ReplaceAll(strings.ReplaceAll(expectBytes, "_", ""), " ", ""),
		strings.ReplaceAll(expectPixels, "_", ""),
	} {
		if !strings.Contains(strings.ReplaceAll(document, ",", ""), want) {
			t.Errorf("generated media limits do not publish enforced constant value %q", want)
		}
	}
}

func mustConstValue(t *testing.T, source, name string) string {
	t.Helper()
	pattern := regexp.MustCompile(`(?m)^\s*` + name + `\s+int64\s*=\s*(.+?)\s*$`)
	match := pattern.FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("constant %s not found in media handler source", name)
	}
	value := int64(1)
	for _, part := range strings.Split(match[1], "*") {
		literal := strings.ReplaceAll(strings.TrimSpace(part), "_", "")
		parsed, err := strconv.ParseInt(literal, 10, 64)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		value *= parsed
	}
	return strconv.FormatInt(value, 10)
}
