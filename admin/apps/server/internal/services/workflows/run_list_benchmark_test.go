package workflows

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func BenchmarkWorkflowRunLists(b *testing.B) {
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, outputBytes := range []int{512, 4096, 16384} {
			b.Run(fmt.Sprintf("%s/50runs_40steps_%dbytes", backend, outputBytes), func(b *testing.B) {
				s, actor := workflowTestServiceWithDB(b, nil, workflowRunListTestDB(b, backend))
				now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
				definition := Definition{Schema: 1, Source: Source{Kind: "manual"}}
				results := make([]StepResult, 0, 40)
				for i := range 40 {
					id := fmt.Sprintf("step-%d", i)
					definition.Steps = append(definition.Steps, Step{ID: id, Kind: KindDraft, Inputs: map[string]Value{"text": reference("source.body")}})
					results = append(results, StepResult{StepID: id, Kind: KindDraft, State: StateSucceeded, Inputs: map[string]any{"text": strings.Repeat("i", outputBytes)}, Output: map[string]any{"text": strings.Repeat("o", outputBytes)}, StartedAt: now, CompletedAt: &now})
				}
				definitionJSON, err := json.Marshal(definition)
				require.NoError(b, err)
				resultsJSON, err := json.Marshal(results)
				require.NoError(b, err)
				sourceJSON, err := json.Marshal(map[string]any{"body": strings.Repeat("s", 32*1024)})
				require.NoError(b, err)
				wf := workflowRecord{ID: "workflow", WorkspaceID: "ws", Name: "Benchmark", Revision: 1, DraftJSON: string(definitionJSON), PublishedJSON: "{}", AuthorityJSON: "{}", CreatedAt: now, UpdatedAt: now}
				_, err = s.db.NewInsert().Model(&wf).Exec(b.Context())
				require.NoError(b, err)
				for i := range 50 {
					run := runRecord{ID: fmt.Sprintf("run-%02d", i), WorkflowID: wf.ID, WorkspaceID: "ws", WorkflowName: wf.Name, WorkflowRevision: 1, Mode: ModePreview, State: StateSucceeded, Revision: 42, DefinitionJSON: string(definitionJSON), ResultsJSON: string(resultsJSON), SourceJSON: string(sourceJSON), AuthorityJSON: "{}", RemainingJSON: "[]", CreatedAt: now.Add(time.Duration(i) * time.Minute), UpdatedAt: now}
					_, err := s.db.NewInsert().Model(&run).Exec(b.Context())
					require.NoError(b, err)
				}
				for _, kind := range []string{"full", "summaries"} {
					b.Run(kind, func(b *testing.B) {
						b.ReportAllocs()
						for b.Loop() {
							var value any
							var err error
							if kind == "full" {
								value, err = s.Runs(b.Context(), actor, "ws", "")
							} else {
								value, err = s.RunSummaries(b.Context(), actor, "ws", "")
							}
							require.NoError(b, err)
							body, err := json.Marshal(value)
							require.NoError(b, err)
							b.ReportMetric(float64(len(body)), "response-bytes")
						}
					})
				}
			})
		}
	}
}
