package messaging

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

var ErrRetryUnsafe = errors.New("check this message on the provider before sending it again")

func (s *Service) RetryMessage(ctx context.Context, actor Actor, workspaceID, conversationID, messageID string) (*models.DirectMessage, error) {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	var message models.DirectMessage
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(txCtx, tx, workspaceID); err != nil {
			return err
		}
		decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(txCtx, workspaceID, actor, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		if !decision.Allowed {
			return ErrAccessDenied
		}
		if err = tx.NewSelect().Model(&message).Where("id=? AND conversation_id=? AND workspace_id=? AND direction='outbound'", messageID, conversationID, workspaceID).Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if message.SendStatus == "sent" || message.SendStatus == "queued" {
			return nil
		}
		if message.SendStatus != "failed" {
			return ErrRetryUnsafe
		}
		if err = s.validateMessageRetry(txCtx, tx, message.ID); err != nil {
			return err
		}
		payload, _ := json.Marshal(subjectJob{ID: message.ID})
		job, err := jobregistry.NewJob(JobTypeMessageSend, string(payload), s.now())
		if err != nil {
			return err
		}
		job.ScopeID = workspaceID
		if _, err = tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(txCtx); err != nil {
			return err
		}
		message.SendStatus = "queued"
		message.ErrorMessage = ""
		if _, err = tx.NewUpdate().Model(&message).Set("send_status='queued'").Set("error_message=''").Set("updated_at=?", s.now()).WherePK().Exec(txCtx); err != nil {
			return err
		}
		return inboxchanges.Append(txCtx, tx, workspaceID, inboxchanges.Change{Kind: "message", ConversationID: conversationID, MessageID: message.ID})
	})
	if err != nil {
		return nil, err
	}
	return &message, nil
}

func (s *Service) validateMessageRetry(ctx context.Context, tx bun.Tx, messageID string) error {
	var attempt models.ProviderWriteAttempt
	err := tx.NewSelect().Model(&attempt).Where("operation_id=?", "messaging:"+messageID).Order("attempt_number DESC").Limit(1).Scan(ctx)
	if err == nil && (attempt.Status != providerwrite.StatusDefiniteFailure || attempt.RetrySafety != string(platform.PublishRetrySafe)) {
		return ErrRetryUnsafe
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return nil
}
