package messaging

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func messagingBackendFixture(t *testing.T, backend string) (*Service, *bun.DB, models.SocialAccount, Actor) {
	t.Helper()
	if backend == "sqlite" {
		return messagingFixture(t)
	}
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	schema := "messaging_deletions_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn), pgdriver.WithConnParams(map[string]any{"search_path": schema})))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err := db.NewRaw(`CREATE SCHEMA ?`, bun.Ident(schema)).Exec(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := db.NewRaw(`DROP SCHEMA ? CASCADE`, bun.Ident(schema)).Exec(context.Background())
		require.NoError(t, err)
	})
	_, err = db.NewRaw(`SET search_path TO ?`, bun.Ident(schema)).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	account := models.SocialAccount{ID: "account", WorkspaceID: "workspace", Platform: "bluesky", AccountID: "did:plc:self", Slug: "self", AccessTokenEnc: []byte("token"), IsActive: true}
	for _, row := range []any{
		&models.User{ID: "user", Email: "messaging@example.test", PasswordHash: "hash"},
		&models.Organization{ID: "org", Name: "Org", CreatedByID: "user"},
		&models.Workspace{ID: "workspace", Name: "Workspace", OrganizationID: "org"},
		&models.WorkspaceMember{WorkspaceID: "workspace", UserID: "user", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		&account,
		&models.Conversation{ID: "conversation", WorkspaceID: "workspace", SocialAccountID: "account", Platform: "bluesky", RemoteConversationID: "remote-thread"},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	s := NewService(db, testToken{}, nil)
	s.SetFeatureGate(testGate{})
	return s, db, account, Actor{UserID: "user"}
}

type historyTestProvider struct {
	testProvider
	page        platform.FetchMessageHistoryResult
	beforeFetch func()
}

func (p historyTestProvider) FetchMessageHistory(context.Context, string, platform.FetchMessageHistoryRequest) (platform.FetchMessageHistoryResult, error) {
	if p.beforeFetch != nil {
		p.beforeFetch()
	}
	return p.page, nil
}

func TestProviderMessageDeletionPrecedesCreationAndHistory(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, deletionScope := range []string{"conversation", "account"} {
			t.Run(backend+"/"+deletionScope, func(t *testing.T) {
				s, db, account, actor := messagingBackendFixture(t, backend)
				now := time.Now().UTC().Truncate(time.Second).Add(time.Hour)
				s.now = func() time.Time { return now }
				deleted := platform.ProviderMessage{ID: "late-message", Direction: "inbound", Body: "deleted private body", AuthorRemoteID: "private-author", RemoteCreatedAt: now.Add(-time.Minute), Attachments: []platform.MessageAttachment{{URL: "https://private.example/image"}}, ReactionsKnown: true, Reactions: []platform.ProviderMessageReaction{{ActorRemoteID: "friend", Value: "heart"}}}
				s.SetProvider("bluesky", historyTestProvider{page: platform.FetchMessageHistoryResult{Messages: []platform.ProviderMessage{deleted, {ID: "surviving-history", Direction: "inbound", Body: "retained history", RemoteCreatedAt: now.Add(-time.Hour)}}}})
				// The list summary can arrive independently of its message page.
				_, err := db.NewUpdate().Model((*models.Conversation)(nil)).Set("last_remote_message_id=?", deleted.ID).Set("last_message_preview=?", deleted.Body).Where("id=?", "conversation").Exec(t.Context())
				require.NoError(t, err)
				remoteConversationID := ""
				if deletionScope == "conversation" {
					remoteConversationID = "remote-thread"
				}
				receipt := platform.FetchMessageEventsResult{DeletedMessages: []platform.DeletedProviderMessage{{ConversationID: remoteConversationID, MessageID: deleted.ID}}}
				require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, receipt))
				var preview string
				require.NoError(t, db.NewSelect().Model((*models.Conversation)(nil)).Column("last_message_preview").Where("id=?", "conversation").Scan(t.Context(), &preview))
				assert.Empty(t, preview, "deletion must clear a summary even before its message is stored")
				batch := platform.FetchMessageEventsResult{Conversations: []platform.ProviderConversation{
					{ID: "remote-thread", LastMessageAt: deleted.RemoteCreatedAt, LastRemoteMessageID: deleted.ID, LastMessagePreview: deleted.Body, Messages: []platform.ProviderMessage{deleted}},
					{ID: "other-thread", LastMessageAt: deleted.RemoteCreatedAt, LastRemoteMessageID: deleted.ID, LastMessagePreview: deleted.Body, Messages: []platform.ProviderMessage{deleted}},
				}}
				metadataOnly := batch.Conversations[0]
				metadataOnly.Messages = nil
				require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{Conversations: []platform.ProviderConversation{metadataOnly}}))
				require.NoError(t, db.NewSelect().Model((*models.Conversation)(nil)).Column("last_message_preview").Where("id=?", "conversation").Scan(t.Context(), &preview))
				require.Empty(t, preview, "metadata-only discovery must not restore deleted content")
				require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, batch))
				require.NoError(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account","conversation_id":"conversation"}`))
				page, err := s.ListMessages(t.Context(), actor, MessageQuery{WorkspaceID: "workspace", ConversationID: "conversation"})
				require.NoError(t, err)
				require.Len(t, page.Items, 1)
				require.Equal(t, "surviving-history", page.Items[0].RemoteMessageID)
				require.NoError(t, db.NewSelect().Model((*models.Conversation)(nil)).Column("last_message_preview").Where("id=?", "conversation").Scan(t.Context(), &preview))
				require.Empty(t, preview, "a stale snapshot must not restore the deleted preview")
				other := account
				other.ID, other.AccountID, other.Slug = "other-account", "other-remote-account", "other-account"
				_, err = db.NewInsert().Model(&other).Exec(t.Context())
				require.NoError(t, err)
				require.NoError(t, s.ApplyProviderEvents(t.Context(), other.ID, platform.FetchMessageEventsResult{Conversations: batch.Conversations[:1]}))
				var stored []models.DirectMessage
				require.NoError(t, db.NewSelect().Model(&stored).Join("JOIN conversations AS c ON c.id=direct_message.conversation_id").Where("direct_message.remote_message_id=?", deleted.ID).Order("c.social_account_id ASC").Scan(t.Context()))
				wantCount := 1
				if deletionScope == "conversation" {
					wantCount++
				}
				require.Len(t, stored, wantCount, "a deletion must not expand across accounts or named conversation scopes")
				for _, message := range stored {
					require.Equal(t, deleted.Body, message.Body)
					require.Contains(t, message.AttachmentsJSON, "private.example")
				}
				// A repeated deletion is idempotent and must not suppress unrelated IDs.
				require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, receipt))
				var reactions int
				require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM message_reactions`).Scan(t.Context(), &reactions))
				require.Equal(t, wantCount, reactions)
			})
		}
	}
}

func TestConversationDeletionSuppressesHistoryUntilNewActivity(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			s, db, account, actor := messagingBackendFixture(t, backend)
			now := time.Now().UTC().Truncate(time.Second).Add(time.Hour)
			s.now = func() time.Time { return now }
			old := platform.ProviderMessage{ID: "old", Direction: "inbound", Body: "deleted conversation body", RemoteCreatedAt: now.Add(-time.Hour)}
			// An unseen old message arriving via history must be blocked too.
			s.SetProvider("bluesky", historyTestProvider{page: platform.FetchMessageHistoryResult{Messages: []platform.ProviderMessage{old}, NextCursor: "older"}})
			require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{DeletedConversations: []string{"remote-thread", "not-discovered"}}))
			stale := platform.FetchMessageEventsResult{Conversations: []platform.ProviderConversation{
				{ID: "remote-thread", LastMessageAt: old.RemoteCreatedAt, LastRemoteMessageID: old.ID, LastMessagePreview: old.Body, Messages: []platform.ProviderMessage{old}},
				{ID: "not-discovered", LastMessageAt: old.RemoteCreatedAt, LastRemoteMessageID: old.ID, LastMessagePreview: old.Body, Messages: []platform.ProviderMessage{old}},
			}}
			require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, stale))
			require.NoError(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account","conversation_id":"conversation"}`))
			count, err := db.NewSelect().Model((*models.DirectMessage)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count, "late history must not restore inaccessible conversation content")
			count, err = db.NewSelect().Model((*models.Conversation)(nil)).Where("remote_conversation_id=?", "not-discovered").Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count, "an unknown deleted conversation must not be rediscovered from old history")
			var conversation models.Conversation
			require.NoError(t, db.NewSelect().Model(&conversation).Where("id=?", "conversation").Scan(t.Context()))
			require.False(t, conversation.ArchivedAt.IsZero())
			require.Empty(t, conversation.LastMessagePreview)
			// Only a genuinely newer provider message can reopen the conversation.
			now = now.Add(time.Minute)
			fresh := platform.ProviderMessage{ID: "new-activity", Direction: "inbound", Body: "new conversation activity", RemoteCreatedAt: now}
			require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{Conversations: []platform.ProviderConversation{{ID: "remote-thread", LastMessageAt: now, LastRemoteMessageID: fresh.ID, LastMessagePreview: fresh.Body, Messages: []platform.ProviderMessage{old, fresh}}}}))
			require.NoError(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account","conversation_id":"conversation"}`))
			page, err := s.ListMessages(t.Context(), actor, MessageQuery{WorkspaceID: "workspace", ConversationID: "conversation"})
			require.NoError(t, err)
			require.Len(t, page.Items, 1)
			require.Equal(t, fresh.ID, page.Items[0].RemoteMessageID)
			require.NoError(t, db.NewSelect().Model(&conversation).Where("id=?", "conversation").Scan(t.Context()))
			require.True(t, conversation.ArchivedAt.IsZero())
			require.Equal(t, fresh.Body, conversation.LastMessagePreview)
		})
	}
}

func TestProviderTombstoneMigrationPreservesExistingDeletions(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			s, db, account, actor := messagingBackendFixture(t, backend)
			old := models.DirectMessage{ID: "retained-deleted-row", WorkspaceID: account.WorkspaceID, ConversationID: "conversation", RemoteMessageID: "deleted-before-upgrade", Direction: "inbound", DeletedAt: s.now()}
			_, err := db.NewInsert().Model(&old).Exec(t.Context())
			require.NoError(t, err)
			// Recreate the pre-168 schema with an existing deleted message.
			for _, statement := range []string{
				`DROP TABLE provider_message_tombstones`,
				`DROP TABLE provider_conversation_tombstones`,
				`DELETE FROM schema_migrations WHERE version=168`,
			} {
				_, err := db.NewRaw(statement).Exec(t.Context())
				require.NoError(t, err)
			}
			require.NoError(t, database.CreateSchema(db))
			// Local-row cleanup after the upgrade must not erase provider truth.
			_, err = db.NewDelete().Model(&old).WherePK().Exec(t.Context())
			require.NoError(t, err)
			require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{Conversations: []platform.ProviderConversation{{ID: "remote-thread", Messages: []platform.ProviderMessage{{ID: old.RemoteMessageID, Direction: "inbound", Body: "must stay deleted", RemoteCreatedAt: s.now()}}}}}))
			page, err := s.ListMessages(t.Context(), actor, MessageQuery{WorkspaceID: account.WorkspaceID, ConversationID: old.ConversationID})
			require.NoError(t, err)
			require.Empty(t, page.Items)
		})
	}
}
