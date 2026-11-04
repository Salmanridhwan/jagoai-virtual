package handlers

import (
	"testing"

	"github.com/openpost/backend/internal/models"
)

func TestListPublicationEventsPostgres(t *testing.T) {
	db := createHandlerPostgresTestDB(t,
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.Publication)(nil), (*models.Rendition)(nil),
		(*models.PublicationLifecycleEvent)(nil), (*models.PublicationAuthorization)(nil),
		(*models.DraftRevisionChange)(nil),
		(*models.ExternalWebhookSubscription)(nil), (*models.ProviderDelivery)(nil),
		(*models.SocialAccount)(nil),
	)
	testPublicationEventsPaginatesSafeActorAttributedHistory(t, db)
}
