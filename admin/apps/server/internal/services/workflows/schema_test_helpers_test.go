package workflows

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

var workflowTestSchemaPath string

func TestMain(m *testing.M) {
	templateDir, err := os.MkdirTemp("", "openpost-workflow-tests-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "create workflow test template directory: %v\n", err)
		os.Exit(1)
	}
	workflowTestSchemaPath = filepath.Join(templateDir, "schema.db")
	db, err := database.InitDB("file:" + workflowTestSchemaPath + "?mode=rwc")
	if err == nil {
		err = database.CreateSchema(db)
	}
	if db != nil {
		if closeErr := db.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "create workflow test schema: %v\n", err)
		_ = os.RemoveAll(templateDir)
		os.Exit(1)
	}

	code := m.Run()
	if err := os.RemoveAll(templateDir); err != nil && code == 0 {
		fmt.Fprintf(os.Stderr, "remove workflow test template directory: %v\n", err)
		code = 1
	}
	os.Exit(code)
}

func newWorkflowSchemaTestDB(t testing.TB) *bun.DB {
	t.Helper()

	testPath := filepath.Join(t.TempDir(), "schema.db")
	schema, err := os.ReadFile(workflowTestSchemaPath)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(testPath, schema, 0o600))

	dsn := url.URL{Scheme: "file", Path: testPath, RawQuery: "mode=rwc"}
	db, err := database.InitDB(dsn.String())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func workflowRunListTestDB(t testing.TB, backend string) *bun.DB {
	t.Helper()
	if backend == "sqlite" {
		return newWorkflowSchemaTestDB(t)
	}
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	db := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	schema := fmt.Sprintf("workflow_runs_test_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, err)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	return db
}
