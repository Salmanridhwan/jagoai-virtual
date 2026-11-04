package usage

import (
	"context"
	"database/sql"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newUsageTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.UsageCounter)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func TestIncrementMonthlyKeepsPeriodsSeparate(t *testing.T) {
	db := newUsageTestDB(t)
	service := NewService(db)
	ctx := context.Background()

	_, err := service.IncrementMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, 2, time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	_, err = service.IncrementMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, 3, time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	require.NoError(t, err)

	june, err := service.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	require.Equal(t, int64(2), june)

	july, err := service.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	require.Equal(t, int64(3), july)
}

func TestLimitedMonthlyUsageAdmitsOnlyRemainingCapacity(t *testing.T) {
	db := newUsageTestDB(t)
	at := time.Now().UTC()
	service := NewService(db)
	_, err := service.IncrementMonthly(t.Context(), "ws-1", entitlements.LimitScheduledPostsMonthly, 9, at)
	require.NoError(t, err)
	var wg sync.WaitGroup
	results := make(chan error, 20)
	for range 20 {
		wg.Go(func() {
			results <- db.RunInTx(t.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
				_, err := IncrementMonthlyLimitedInTransaction(ctx, tx, "ws-1", entitlements.LimitScheduledPostsMonthly, 1, at, entitlements.Decision{Allowed: true, Limit: 10})
				return err
			})
		})
	}
	wg.Wait()
	close(results)
	admitted := 0
	for err := range results {
		if err == nil {
			admitted++
		} else {
			require.ErrorIs(t, err, ErrQuotaExceeded)
		}
	}
	require.Equal(t, 1, admitted)
	value, err := service.CurrentMonthly(t.Context(), "ws-1", entitlements.LimitScheduledPostsMonthly, at)
	require.NoError(t, err)
	require.Equal(t, int64(10), value)
	_, err = IncrementMonthlyLimitedInTransaction(t.Context(), db, "ws-1", entitlements.LimitPublishedPostsMonthly, 11, at, entitlements.Decision{Allowed: true, Limit: 10})
	require.ErrorIs(t, err, ErrQuotaExceeded)
	value, err = service.CurrentMonthly(t.Context(), "ws-1", entitlements.LimitPublishedPostsMonthly, at)
	require.NoError(t, err)
	require.Zero(t, value)
}
