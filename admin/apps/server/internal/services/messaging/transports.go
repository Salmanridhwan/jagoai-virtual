package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerinbox"
)

func (s *Service) ProcessMetaReceipt(ctx context.Context, event providerinbox.Event, engagementRefresh func(context.Context, string, json.RawMessage) error) error {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id=? AND is_active=?", event.AccountID, true).Scan(ctx); err != nil {
		return err
	}
	if event.Kind == "engagement" {
		if engagementRefresh == nil {
			return errors.New("comment collector is unavailable")
		}
		var payload providerinbox.MetaEvent
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return err
		}
		return engagementRefresh(ctx, account.ID, payload.Change)
	}
	if !s.isMessagingEnabled(ctx, account.ID) {
		return nil
	}
	adapter, ok := s.provider(account).(platform.MetaMessagingWebhookAdapter)
	if !ok {
		return errors.New("provider callback adapter is unavailable")
	}
	var payload providerinbox.MetaEvent
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return err
	}
	token, err := s.messagingToken(ctx, account)
	if err != nil {
		return err
	}
	batch, err := adapter.NormalizeMessagingWebhook(ctx, token, account.AccountID, payload.Messaging)
	if err != nil {
		return err
	}
	return s.ApplyProviderEvents(ctx, account.ID, batch)
}

// RunTransports owns stream lifetimes, cancellation and joining. Durable account
// leases keep one upstream stream across replicas; no job holds an open stream.
func (s *Service) RunTransports(ctx context.Context, ingress *providerinbox.Service) {
	type running struct {
		cancel context.CancelFunc
		done   chan struct{}
	}
	streams := map[string]running{}
	var group sync.WaitGroup
	defer func() {
		for _, r := range streams {
			r.cancel()
		}
		group.Wait()
	}()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		var accounts []models.SocialAccount
		if err := s.db.NewSelect().Model(&accounts).Where("is_active=? AND platform=?", true, "mastodon").Scan(ctx); err != nil && ctx.Err() == nil {
			log.Printf("discover inbox streams: %v", err)
		}
		for _, account := range accounts {
			if current, ok := streams[account.ID]; ok {
				select {
				case <-current.done:
					delete(streams, account.ID)
				default:
					continue
				}
			}
			adapter, ok := s.provider(account).(platform.MessageStreamAdapter)
			if !ok || !s.isMessagingEnabled(ctx, account.ID) {
				continue
			}
			streamCtx, cancel := context.WithCancel(ctx)
			done := make(chan struct{})
			streams[account.ID] = running{cancel, done}
			group.Add(1)
			go func(account models.SocialAccount, adapter platform.MessageStreamAdapter) {
				defer group.Done()
				defer close(done)
				s.runAccountStream(streamCtx, ingress, account, adapter)
			}(account, adapter)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) runAccountStream(streamCtx context.Context, ingress *providerinbox.Service, account models.SocialAccount, adapter platform.MessageStreamAdapter) {
	eligible := func(checkCtx context.Context) (bool, error) {
		active, err := s.db.NewSelect().Model((*models.SocialAccount)(nil)).Where("id=? AND is_active=? AND oauth_grant_id=?", account.ID, true, account.OAuthGrantID).Exists(checkCtx)
		return active && s.isMessagingEnabled(checkCtx, account.ID), err
	}
	err := ingress.RunLeasedStream(streamCtx, account.ID, eligible, func(connectionCtx context.Context) error {
		token, err := s.messagingToken(connectionCtx, account)
		if err != nil {
			return err
		}
		repair := func(repairCtx context.Context) error {
			return s.repairStreamGap(repairCtx, account, token)
		}
		return adapter.StreamMessageEvents(connectionCtx, token, account.AccountID, repair, func(applyCtx context.Context, batch platform.FetchMessageEventsResult) error {
			return s.ApplyProviderEvents(applyCtx, account.ID, batch)
		})
	})
	if err != nil && streamCtx.Err() == nil {
		log.Printf("inbox stream ended for account %s", account.ID)
	}
}

func (s *Service) repairStreamGap(ctx context.Context, account models.SocialAccount, token string) error {
	cursor := ""
	for page := 0; page < 100; page++ {
		snapshot, err := s.provider(account).FetchMessages(ctx, token, platform.FetchMessagesRequest{AccountID: account.AccountID, Cursor: cursor, Limit: 100})
		if err != nil {
			return err
		}
		if err = s.ApplyProviderEvents(ctx, account.ID, platform.FetchMessageEventsResult{Conversations: snapshot.Conversations}); err != nil {
			return err
		}
		if snapshot.NextCursor == "" {
			return nil
		}
		if snapshot.NextCursor == cursor {
			return errors.New("provider history cursor did not advance")
		}
		cursor = snapshot.NextCursor
	}
	return errors.New("provider gap repair exceeded its page budget")
}
