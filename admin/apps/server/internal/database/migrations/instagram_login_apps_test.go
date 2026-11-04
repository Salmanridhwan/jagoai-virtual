package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestInstagramLoginAppMigrationPreservesLegacyCredentials(t *testing.T) {
	verifyInstagramLoginMigration(t, newMigrationsTestDB(t))
}

func TestInstagramLoginAppMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	admin := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
	t.Cleanup(func() { require.NoError(t, admin.Close()) })
	schema := fmt.Sprintf("instagram_login_%d", time.Now().UnixNano())
	_, err := admin.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := admin.ExecContext(context.Background(), `DROP SCHEMA "`+schema+`" CASCADE`)
		require.NoError(t, err)
	})
	db := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn), pgdriver.WithConnParams(map[string]any{"search_path": schema}))), pgdialect.New())
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	verifyInstagramLoginMigration(t, db)
}

func verifyInstagramLoginMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	source := fstest.MapFS{}
	for _, name := range []string{"024_provider_apps.sql", "115_provider_bot_app_credentials.sql"} {
		body, err := migrationFiles.ReadFile(name)
		require.NoError(t, err)
		source[name] = &fstest.MapFile{Data: body}
	}
	require.NoError(t, runMigrations(db, source))
	_, err := db.ExecContext(t.Context(), `INSERT INTO provider_apps (id, provider, client_id) VALUES ('legacy', 'instagram', 'facebook-client')`)
	require.NoError(t, err)
	body, err := migrationFiles.ReadFile("162_instagram_login_apps.sql")
	require.NoError(t, err)
	source["162_instagram_login_apps.sql"] = &fstest.MapFile{Data: body}
	require.NoError(t, runMigrations(db, source))
	require.NoError(t, runMigrations(db, source))
	_, err = db.ExecContext(t.Context(), `INSERT INTO provider_apps (id, provider, connection_mode, client_id) VALUES ('direct', 'instagram', 'instagram_login', 'instagram-client')`)
	require.NoError(t, err)
	var clientID string
	require.NoError(t, db.NewSelect().Table("provider_apps").Column("client_id").Where("id = 'legacy'").Scan(t.Context(), &clientID))
	require.Equal(t, "facebook-client", clientID)
	_, err = db.ExecContext(t.Context(), `INSERT INTO provider_apps (id, provider, connection_mode) VALUES ('duplicate', 'instagram', 'oauth')`)
	require.Error(t, err)
	require.Contains(t, strings.ToLower(err.Error()), "unique", "legacy and explicit Facebook Login must still share one configuration identity")
}
