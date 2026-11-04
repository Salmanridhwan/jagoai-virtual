package messaging

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

// ApplyProviderEvents is the sole inbox ingress owner. Raw provider events have
// already been authenticated by their transport; this method rechecks current
// account eligibility, then commits normalized state and its checkpoint together.
func (s *Service) ApplyProviderEvents(ctx context.Context, accountID string, batch platform.FetchMessageEventsResult) error {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id=? AND is_active=?", accountID, true).Scan(ctx); err != nil {
		return err
	}
	if !s.isMessagingEnabled(ctx, account.ID) {
		return fmt.Errorf("messaging is disabled for this account")
	}
	var received []receivedMessage
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var err error
		received, err = s.applyProviderEventBatch(txCtx, tx, account, batch)
		return err
	})
	if err == nil {
		s.notifyReceivedMessages(ctx, account, received)
	}
	return err
}

func (s *Service) applyProviderEventBatch(ctx context.Context, tx bun.Tx, account models.SocialAccount, batch platform.FetchMessageEventsResult) ([]receivedMessage, error) {
	if err := organizationguard.LockWorkspace(ctx, tx, account.WorkspaceID); err != nil {
		return nil, err
	}
	if !s.isMessagingEnabledWithDB(ctx, tx, account.ID) {
		return nil, nil
	}
	// The account can be disconnected while a transport callback is waiting.
	active, err := tx.NewSelect().Model((*models.SocialAccount)(nil)).Where("id=? AND workspace_id=? AND is_active=?", account.ID, account.WorkspaceID, true).Exists(ctx)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, ErrNotFound
	}
	changes, err := s.applyDeletedMessages(ctx, tx, account, batch.DeletedMessages)
	if err != nil {
		return nil, err
	}
	applied, err := s.applyDeletedConversations(ctx, tx, account, batch.DeletedConversations)
	if err != nil {
		return nil, err
	}
	changes = append(changes, applied...)
	received, err := s.persistConversationsWithDB(ctx, tx, account, batch.Conversations)
	if err != nil {
		return nil, err
	}
	applied, err = s.applyProviderReadStates(ctx, tx, account, batch.ReadStates)
	if err != nil {
		return nil, err
	}
	changes = append(changes, applied...)
	applied, err = s.applyMessageReactions(ctx, tx, account, batch.Reactions)
	if err != nil {
		return nil, err
	}
	changes = append(changes, applied...)
	if batch.NextCursor != "" {
		if _, err = tx.NewRaw(`INSERT INTO message_event_checkpoints(social_account_id,cursor) VALUES(?,?) ON CONFLICT(social_account_id) DO UPDATE SET cursor=EXCLUDED.cursor`, account.ID, batch.NextCursor).Exec(ctx); err != nil {
			return nil, err
		}
	}
	return received, inboxchanges.Append(ctx, tx, account.WorkspaceID, changes...)
}

func (s *Service) applyDeletedMessages(ctx context.Context, tx bun.Tx, account models.SocialAccount, deletedMessages []platform.DeletedProviderMessage) ([]inboxchanges.Change, error) {
	changes := []inboxchanges.Change{}
	for _, deleted := range deletedMessages {
		if deleted.MessageID == "" {
			continue
		}
		if err := recordProviderMessageDeletion(ctx, tx, account.ID, deleted, s.now()); err != nil {
			return nil, err
		}
		previews, err := clearDeletedMessagePreviews(ctx, tx, account.ID, deleted)
		if err != nil {
			return nil, err
		}
		changes = append(changes, previews...)
		var messages []models.DirectMessage
		query := tx.NewSelect().Model(&messages).Join("JOIN conversations AS conversation ON conversation.id=direct_message.conversation_id").Where("conversation.social_account_id=? AND direct_message.remote_message_id=?", account.ID, deleted.MessageID)
		if deleted.ConversationID != "" {
			query = query.Where("conversation.remote_conversation_id=?", deleted.ConversationID)
		}
		if err = query.Scan(ctx); err != nil {
			return nil, err
		}
		for _, m := range messages {
			if !m.DeletedAt.IsZero() {
				continue
			}
			if _, err = tx.NewUpdate().Model(&m).Set("body=''").Set("attachments_json='[]'").Set("author_remote_id=''").Set("deleted_at=?", s.now()).Set("updated_at=?", s.now()).WherePK().Exec(ctx); err != nil {
				return nil, err
			}
			if _, err = tx.NewDelete().Table("message_reactions").Where("message_id=?", m.ID).Exec(ctx); err != nil {
				return nil, err
			}
			changes = append(changes, inboxchanges.Change{Kind: "message", ConversationID: m.ConversationID, MessageID: m.ID, Deleted: true})
		}
	}
	return changes, nil
}

func (s *Service) applyProviderReadStates(ctx context.Context, tx bun.Tx, account models.SocialAccount, reads []platform.ProviderReadState) ([]inboxchanges.Change, error) {
	changes := []inboxchanges.Change{}
	for _, read := range reads {
		applied, err := s.applyProviderReadState(ctx, tx, account, read)
		if err != nil {
			return nil, err
		}
		changes = append(changes, applied...)
	}
	return changes, nil
}

func (s *Service) applyProviderReadState(ctx context.Context, tx bun.Tx, account models.SocialAccount, read platform.ProviderReadState) ([]inboxchanges.Change, error) {
	changes := []inboxchanges.Change{}
	var err error
	var c models.Conversation
	if err = tx.NewSelect().Model(&c).Where("social_account_id=? AND remote_conversation_id=?", account.ID, read.ConversationID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	if read.ActorRemoteID == account.AccountID {
		// A delayed own-read event cannot clear unread for a newer message.
		if read.MessageID != "" && read.MessageID == c.LastRemoteMessageID {
			if _, err = tx.NewUpdate().Model(&c).Set("unread_count=0").Set("read_at=?", s.now()).WherePK().Exec(ctx); err != nil {
				return nil, err
			}
			changes = append(changes, inboxchanges.Change{Kind: "conversation", ConversationID: c.ID})
		}
		return changes, nil
	}
	if read.ActorRemoteID == "" {
		return nil, nil
	}
	return s.applyCounterpartReadState(ctx, tx, c.ID, read)
}

func (s *Service) applyCounterpartReadState(ctx context.Context, tx bun.Tx, conversationID string, read platform.ProviderReadState) ([]inboxchanges.Change, error) {
	at := read.ReadAt
	if at.IsZero() {
		if read.MessageID == "" {
			return nil, nil
		}
		at = s.now()
	}
	var messages []models.DirectMessage
	query := tx.NewSelect().Model(&messages).
		Where("conversation_id=? AND direction='outbound'", conversationID).
		Where("(provider_read_at IS NULL OR provider_read_at<?)", at)
	if read.MessageID != "" {
		query = query.Where("remote_message_id=?", read.MessageID)
	} else {
		// Meta reports a read watermark instead of a single message identity.
		// Unknown provider timestamps and local pending writes are not covered.
		query = query.Where("remote_created_at<=?", at)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	changes := make([]inboxchanges.Change, 0, len(messages))
	for _, message := range messages {
		if _, err := tx.NewUpdate().Model(&message).Set("provider_read_at=?", at).
			WherePK().Where("(provider_read_at IS NULL OR provider_read_at<?)", at).Exec(ctx); err != nil {
			return nil, err
		}
		changes = append(changes, inboxchanges.Change{Kind: "message", ConversationID: conversationID, MessageID: message.ID})
	}
	return changes, nil
}

func (s *Service) applyMessageReactions(ctx context.Context, tx bun.Tx, account models.SocialAccount, reactions []platform.ProviderMessageReaction) ([]inboxchanges.Change, error) {
	changes := []inboxchanges.Change{}
	var err error
	for _, reaction := range reactions {
		var m models.DirectMessage
		err = tx.NewSelect().Model(&m).Join("JOIN conversations AS conversation ON conversation.id=direct_message.conversation_id").Where("conversation.social_account_id=? AND conversation.remote_conversation_id=? AND direct_message.remote_message_id=? AND direct_message.deleted_at IS NULL", account.ID, reaction.ConversationID, reaction.MessageID).Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if reaction.Deleted {
			_, err = tx.NewRaw(`DELETE FROM message_reactions WHERE message_id=? AND actor_remote_id=? AND value=?`, m.ID, reaction.ActorRemoteID, reaction.Value).Exec(ctx)
		} else {
			_, err = tx.NewRaw(`INSERT INTO message_reactions(message_id,actor_remote_id,value) VALUES(?,?,?) ON CONFLICT DO NOTHING`, m.ID, reaction.ActorRemoteID, reaction.Value).Exec(ctx)
		}
		if err != nil {
			return nil, err
		}
		changes = append(changes, inboxchanges.Change{Kind: "message", ConversationID: m.ConversationID, MessageID: m.ID})
	}
	return changes, nil
}

func (s *Service) applyDeletedConversations(ctx context.Context, tx bun.Tx, account models.SocialAccount, remoteIDs []string) ([]inboxchanges.Change, error) {
	changes := []inboxchanges.Change{}
	var err error
	for _, remoteID := range remoteIDs {
		if remoteID == "" {
			continue
		}
		if err := recordProviderConversationDeletion(ctx, tx, account.ID, remoteID, s.now()); err != nil {
			return nil, err
		}
		var c models.Conversation
		if err = tx.NewSelect().Model(&c).Where("social_account_id=? AND remote_conversation_id=?", account.ID, remoteID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
			continue
		} else if err != nil {
			return nil, err
		}
		// Keep local pending writes and operation receipts inspectable, but remove
		// provider content and archive a conversation no longer accessible remotely.
		if _, err = tx.NewUpdate().Model((*models.DirectMessage)(nil)).Set("body=''").Set("attachments_json='[]'").Set("author_remote_id=''").Set("deleted_at=?", s.now()).Where("conversation_id=? AND remote_message_id<>''", c.ID).Exec(ctx); err != nil {
			return nil, err
		}
		if _, err = tx.NewRaw(`DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM direct_messages WHERE conversation_id=? AND remote_message_id<>'')`, c.ID).Exec(ctx); err != nil {
			return nil, err
		}
		if _, err = tx.NewUpdate().Model(&c).Set("archived_at=?", s.now()).Set("last_message_preview=''").Set("unread_count=0").WherePK().Exec(ctx); err != nil {
			return nil, err
		}
		changes = append(changes, inboxchanges.Change{Kind: "conversation", ConversationID: c.ID, Deleted: true})
	}
	return changes, nil
}
