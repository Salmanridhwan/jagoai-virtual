package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"reflect"
)

func TestInboxCommandsPreserveFiltersReceiptsAndNativeContext(t *testing.T) {
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	equal := func(expected, actual any) {
		t.Helper()
		if !reflect.DeepEqual(expected, actual) {
			t.Errorf("expected %#v, got %#v", expected, actual)
		}
	}
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/workspaces" {
			_, _ = w.Write([]byte(`[{"id":"w","name":"Production"}]`))
			return
		}
		equal("Bearer op_cli_test", r.Header.Get("Authorization"))
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Method == http.MethodGet {
			equal("w", r.URL.Query().Get("workspace_id"))
			if r.URL.Path == "/api/v1/engagement" {
				equal("review", r.URL.Query().Get("kind"))
				equal("opaque&cursor", r.URL.Query().Get("cursor"))
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"review","kind":"review","subject":{"review":{"anonymous":true,"stars":5}}}],"next_cursor":"next"}`))
			return
		}
		var body map[string]any
		must(json.NewDecoder(r.Body).Decode(&body))
		equal("w", body["workspace_id"])
		switch r.URL.Path {
		case "/api/v1/engagement/read":
			equal("mention", body["kind"])
			equal(true, body["archived"])
			_, _ = w.Write([]byte(`{"updated_count":142}`))
		case "/api/v1/engagement/review/actions":
			equal("reply", body["action"])
			equal("Thanks 日本語", body["message"])
			equal("intent", body["client_operation_id"])
			_, _ = w.Write([]byte(`{"job_id":"reply-receipt"}`))
		case "/api/v1/engagement/state":
			equal(false, body["read"])
			equal([]any{"review", "mention"}, body["ids"])
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()
	base := []string{"--instance", server.URL, "--token", "op_cli_test", "--workspace", "Production", "--json"}
	for _, command := range [][]string{
		{"inbox", "list", "--kind", "review", "--cursor", "opaque&cursor"},
		{"inbox", "mark-read", "--kind", "mention", "--archived"},
		{"inbox", "act", "review", "--message", "Thanks 日本語", "--operation-id", "intent"},
		{"inbox", "state", "review", "mention", "--read=false"},
	} {
		output, err := executeRootCaptureStdout(t, append(append([]string{}, base...), command...)...)
		must(err)
		if !json.Valid([]byte(output)) {
			t.Fatalf("invalid output: %s", output)
		}
	}
	equal([]string{"GET /api/v1/engagement", "POST /api/v1/engagement/read", "POST /api/v1/engagement/review/actions", "POST /api/v1/engagement/state"}, calls)
}
