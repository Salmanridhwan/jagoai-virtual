package queue

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestChatDispatchDoesNotWaitForSlowMediaJob(t *testing.T) {
	db := createTestDB(t)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	now := time.Now().UTC().Add(-time.Minute)
	for _, kind := range []string{jobregistry.TypeMediaAnalyze, jobregistry.TypeMessageSend} {
		job, err := jobregistry.NewJob(kind, `{"id":"item"}`, now)
		require.NoError(t, err)
		_, err = db.NewInsert().Model(job).Exec(t.Context())
		require.NoError(t, err)
	}
	general := NewWorker(db, "general", time.Second, nil, nil, nil)
	general.ExcludeJobTypes(jobregistry.TypeMessageSend)
	chat := NewWorker(db, "chat", time.Second, nil, nil, nil)
	chat.SetJobTypes(jobregistry.TypeMessageSend)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	general.executors[jobregistry.ExecuteVideo] = func(context.Context, *models.Job) error { close(entered); <-release; return nil }
	chat.executors[jobregistry.ExecuteMessaging] = func(context.Context, *models.Job) error { return nil }
	go func() { defer close(done); general.processNextJobIfAvailable(t.Context()) }()
	<-entered
	require.True(t, chat.processNextJobIfAvailable(t.Context()))
	var sent models.Job
	require.NoError(t, db.NewSelect().Model(&sent).Where("type=?", jobregistry.TypeMessageSend).Scan(t.Context()))
	require.Equal(t, jobregistry.StatusCompleted, sent.Status)
	close(release)
	<-done
}
