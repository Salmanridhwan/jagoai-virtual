package messaging

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/uptrace/bun"
)

func recordProviderMessageDeletion(ctx context.Context, db bun.IDB, accountID string, deleted platform.DeletedProviderMessage, at time.Time) error {
	_, err := db.NewRaw(`INSERT INTO provider_message_tombstones(social_account_id,remote_conversation_id,remote_message_id,deleted_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`, accountID, deleted.ConversationID, deleted.MessageID, at).Exec(ctx)
	return err
}

func recordProviderConversationDeletion(ctx context.Context, db bun.IDB, accountID, remoteID string, at time.Time) error {
	_, err := db.NewRaw(`INSERT INTO provider_conversation_tombstones(social_account_id,remote_conversation_id,deleted_at) VALUES(?,?,?) ON CONFLICT(social_account_id,remote_conversation_id) DO UPDATE SET deleted_at=CASE WHEN EXCLUDED.deleted_at>provider_conversation_tombstones.deleted_at THEN EXCLUDED.deleted_at ELSE provider_conversation_tombstones.deleted_at END`, accountID, remoteID, at).Exec(ctx)
	return err
}

func providerMessageSuppressed(ctx context.Context, db bun.IDB, accountID, conversationID, messageID string, createdAt time.Time) (bool, error) {
	var suppressed bool
	err := db.NewRaw(`SELECT EXISTS (
		SELECT 1 FROM provider_message_tombstones
		WHERE social_account_id=? AND remote_message_id=? AND (remote_conversation_id='' OR remote_conversation_id=?)
	) OR EXISTS (
		SELECT 1 FROM provider_conversation_tombstones
		WHERE social_account_id=? AND remote_conversation_id=? AND (? OR deleted_at>=?)
	)`, accountID, messageID, conversationID, accountID, conversationID, createdAt.IsZero(), createdAt).Scan(ctx, &suppressed)
	return suppressed, err
}

func providerConversationDeletedAt(ctx context.Context, db bun.IDB, accountID, conversationID string) (time.Time, error) {
	var deletedAt time.Time
	err := db.NewRaw(`SELECT deleted_at FROM provider_conversation_tombstones WHERE social_account_id=? AND remote_conversation_id=?`, accountID, conversationID).Scan(ctx, &deletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, nil
	}
	return deletedAt, err
}

func prepareProviderConversation(ctx context.Context, db bun.IDB, account models.SocialAccount, remote platform.ProviderConversation) (platform.ProviderConversation, bool, error) {
	deletedAt, err := providerConversationDeletedAt(ctx, db, account.ID, remote.ID)
	if err != nil {
		return remote, false, err
	}
	messages := make([]platform.ProviderMessage, 0, len(remote.Messages))
	suppressed := false
	for _, message := range remote.Messages {
		blocked, err := providerMessageSuppressed(ctx, db, account.ID, remote.ID, message.ID, message.RemoteCreatedAt)
		if err != nil {
			return remote, false, err
		}
		if blocked {
			suppressed = true
			continue
		}
		messages = append(messages, message)
	}
	remote.Messages = messages
	if !deletedAt.IsZero() {
		if len(messages) == 0 {
			return remote, false, nil
		}
		// Metadata alone cannot reopen a remotely deleted conversation. Every
		// retained message has a known provider time after the deletion cutoff.
		if _, err := db.NewUpdate().Model((*models.Conversation)(nil)).Set("archived_at=NULL").Where("social_account_id=? AND remote_conversation_id=?", account.ID, remote.ID).Exec(ctx); err != nil {
			return remote, false, err
		}
	}
	remote, err = suppressDeletedPreview(ctx, db, account.ID, remote, suppressed)
	return remote, true, err
}

func suppressDeletedPreview(ctx context.Context, db bun.IDB, accountID string, remote platform.ProviderConversation, suppressedMessages bool) (platform.ProviderConversation, error) {
	blocked, err := providerMessageSuppressed(ctx, db, accountID, remote.ID, remote.LastRemoteMessageID, remote.LastMessageAt)
	if err != nil {
		return remote, err
	}
	if blocked || (suppressedMessages && remote.LastRemoteMessageID == "") {
		remote.LastMessagePreview = ""
	}
	return remote, nil
}

func clearDeletedMessagePreviews(ctx context.Context, db bun.IDB, accountID string, deleted platform.DeletedProviderMessage) ([]inboxchanges.Change, error) {
	var conversations []models.Conversation
	query := db.NewSelect().Model(&conversations).Where("social_account_id=? AND last_remote_message_id=? AND last_message_preview<>''", accountID, deleted.MessageID)
	if deleted.ConversationID != "" {
		query = query.Where("remote_conversation_id=?", deleted.ConversationID)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	changes := make([]inboxchanges.Change, 0, len(conversations))
	for _, conversation := range conversations {
		if _, err := db.NewUpdate().Model(&conversation).Set("last_message_preview=''").WherePK().Exec(ctx); err != nil {
			return nil, err
		}
		changes = append(changes, inboxchanges.Change{Kind: "conversation", ConversationID: conversation.ID})
	}
	return changes, nil
}
