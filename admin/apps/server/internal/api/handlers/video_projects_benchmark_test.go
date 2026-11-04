package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
)

// Include JSON encoding: projection is followed by the HTTP response encoder.
func BenchmarkVideoProjectResponse(b *testing.B) {
	for _, itemCount := range []int{10, 100, 500} {
		b.Run(fmt.Sprintf("items_%d", itemCount), func(b *testing.B) {
			document := benchmarkVideoDocument(b, itemCount)
			project := &models.VideoProject{ID: "benchmark", Name: "Demonstration", DocumentJSON: string(document)}
			b.ReportAllocs()
			b.SetBytes(int64(len(document)))
			b.ResetTimer()
			for b.Loop() {
				response, err := videoProjectResponse(project)
				if err != nil {
					b.Fatal(err)
				}
				if _, err := json.Marshal(response); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func benchmarkVideoDocument(b *testing.B, itemCount int) []byte {
	b.Helper()
	frames := make([]int, 120)
	values := make([]float64, len(frames))
	for i := range frames {
		frames[i] = i * 5
		values[i] = float64(i) / 119
	}
	items := make([]map[string]any, itemCount)
	for i := range items {
		items[i] = map[string]any{
			"id": fmt.Sprintf("clip-%d", i), "type": "video", "from": i * 30,
			"durationInFrames": 600, "label": "Recorded product demonstration",
			"transform": map[string]any{"x": 120, "y": 80, "width": 1920, "height": 1080},
			"keyframes": map[string]any{"opacity": map[string]any{"frames": frames, "values": values}},
		}
	}
	document, err := json.Marshal(map[string]any{
		"schemaFamily": "openpost", "schemaVersion": 11,
		"metadata": map[string]any{"width": 1920, "height": 1080, "fps": 30},
		"timeline": map[string]any{"items": items},
	})
	if err != nil {
		b.Fatal(err)
	}
	return document
}

func BenchmarkVideoProjectListHTTP(b *testing.B) {
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, projectCount := range []int{10, 50} {
			for _, endpoint := range []string{"video-projects", "video-project-summaries"} {
				b.Run(fmt.Sprintf("%s/%s/projects_%d", backend, endpoint, projectCount), func(b *testing.B) {
					var server *videoProjectTestServer
					if backend == "postgres" {
						server = newPostgresVideoProjectTestServer(b)
					} else {
						server = newVideoProjectTestServer(b)
						b.Cleanup(func() { _ = server.db.Close() })
					}
					document := benchmarkVideoDocument(b, 100)
					projects := make([]models.VideoProject, projectCount)
					for i := range projects {
						id := fmt.Sprintf("project-%03d", i)
						// Distinct documents avoid measuring the database's repeated-value JSON cache.
						projectDocument := strings.Replace(string(document), `{`, fmt.Sprintf(`{"id":%q,`, id), 1)
						projects[i] = models.VideoProject{ID: id, WorkspaceID: "ws-1", Name: "Demonstration", DocumentJSON: projectDocument, CreatedByUserID: "user-editor", UpdatedByUserID: "user-editor"}
					}
					if _, err := server.db.NewInsert().Model(&projects).Exec(b.Context()); err != nil {
						b.Fatal(err)
					}
					b.ReportAllocs()
					b.ResetTimer()
					for b.Loop() {
						response := server.request(b, "viewer-token", http.MethodGet, "/api/v1/"+endpoint+"?workspace_id=ws-1", nil)
						if response.Code != http.StatusOK {
							b.Fatalf("%d: %s", response.Code, response.Body.String())
						}
						b.ReportMetric(float64(response.Body.Len()), "response-bytes")
					}
				})
			}
		}
	}
}
