package messaging

import (
	"context"
	"errors"

	"github.com/openpost/backend/internal/models"
)

// SupplementalMessagingTokens keeps a messaging grant separate from publishing.
// The source alone decides whether fallback is safe.
type SupplementalMessagingTokens interface {
	AccessToken(context.Context, string, string) (string, error)
}

func (s *Service) SetMessagingTokenSource(source SupplementalMessagingTokens, notConnected error) {
	s.messagingTokens = source
	s.messagingNotConnected = notConnected
}
func (s *Service) messagingToken(ctx context.Context, account models.SocialAccount) (string, error) {
	if account.Platform == "x" && s.messagingTokens != nil {
		token, err := s.messagingTokens.AccessToken(ctx, account.WorkspaceID, account.ID)
		if err == nil {
			return token, nil
		}
		if s.messagingNotConnected == nil || !errors.Is(err, s.messagingNotConnected) {
			return "", err
		}
	}
	if s.tokens == nil {
		return "", errors.New("messaging token source is unavailable")
	}
	return s.tokens.GetValidAccessToken(ctx, account.ID)
}
