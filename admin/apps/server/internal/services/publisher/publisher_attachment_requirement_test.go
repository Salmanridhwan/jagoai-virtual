package publisher

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestQueuedMissingAttachmentStopsBeforeProviderWrite(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	_, err := srv.db.NewInsert().Model(&models.PublicationSegment{ID: "source", PublicationID: "publication-1", Body: "Watch the demo", SettingsJSON: `{}`}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.RenditionSegment{ID: "output", RenditionID: "rendition-1", PublicationSegmentID: "source", Body: "Watch the demo", SettingsJSON: `{"attachment_requirement":{"kind":"video","brief":"Show the interaction"}}`, Status: models.RenditionStatusReady}).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, srv.publishPublication(t))
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusFailed, rendition.Status)
	require.Equal(t, FailureValidation, rendition.ErrorKind)
	require.Equal(t, FailureActionEdit, rendition.ErrorAction)
	require.Zero(t, adapter.publishCalls)
}
