package handlers

import (
	"fmt"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func mediaUsageTestDB(t testing.TB, backend string) *bun.DB {
	t.Helper()
	tables := []any{
		(*models.Publication)(nil), (*models.PublicationAsset)(nil),
		(*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil), (*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil),
		(*models.ScreenshotTemplateMediaReference)(nil), (*models.ScreenshotTemplateRecipeMediaReference)(nil),
		(*models.DesignDocument)(nil), (*models.DesignPage)(nil), (*models.DesignRevision)(nil),
		(*models.DesignMediaReference)(nil), (*models.DesignRevisionMediaReference)(nil),
		(*models.DesignTemplate)(nil), (*models.DesignTemplateMediaReference)(nil), (*models.BrandFont)(nil),
	}
	var db *bun.DB
	if backend == "postgres" {
		db = createHandlerPostgresTestDB(t, tables...)
	} else {
		db = createHandlerTestDB(t, tables...)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
	}
	// Match the media lookup indexes owned by migrations 018, 027 and 034.
	for _, table := range []string{"publication_assets", "publication_segment_media", "rendition_media", "rendition_segment_media"} {
		_, err := db.NewCreateIndex().Index(table + "_media_idx").Table(table).Column("media_id").Exec(t.Context())
		require.NoError(t, err)
	}
	return db
}

func BenchmarkMediaUsageSummaries(b *testing.B) {
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, publicationCount := range []int{100, 1000, 10000} {
			b.Run(fmt.Sprintf("%s/publications_%d", backend, publicationCount), func(b *testing.B) {
				db := mediaUsageTestDB(b, backend)
				mediaIDs := make([]string, 50)
				for i := range mediaIDs {
					mediaIDs[i] = fmt.Sprintf("media-%02d", i)
				}
				for offset := 0; offset < publicationCount; offset += 100 {
					publications := make([]models.Publication, 100)
					segments := make([]models.PublicationSegment, 100)
					assets := make([]models.PublicationAsset, 0, 1000)
					segmentMedia := make([]models.PublicationSegmentMedia, 0, 1000)
					for i := range publications {
						id := fmt.Sprintf("publication-%05d", offset+i)
						status := models.PublicationStatusPublished
						if i%2 == 0 {
							status = models.PublicationStatusScheduled
						}
						publications[i] = models.Publication{ID: id, WorkspaceID: "workspace", CreatedByID: "user", Status: status}
						segments[i] = models.PublicationSegment{ID: id, PublicationID: id}
						for n := 0; n < 10; n++ {
							mediaID := mediaIDs[(offset+i+n)%len(mediaIDs)]
							assets = append(assets, models.PublicationAsset{PublicationID: id, MediaID: mediaID})
							segmentMedia = append(segmentMedia, models.PublicationSegmentMedia{SegmentID: id, MediaID: mediaID})
						}
					}
					for _, rows := range []any{&publications, &segments, &assets, &segmentMedia} {
						_, err := db.NewInsert().Model(rows).Exec(b.Context())
						require.NoError(b, err)
					}
				}
				_, err := db.ExecContext(b.Context(), "ANALYZE")
				require.NoError(b, err)
				handler := &MediaHandler{db: db}
				b.ReportAllocs()
				b.ResetTimer()
				for b.Loop() {
					usage, err := handler.mediaUsageSummaries(b.Context(), "workspace", mediaIDs)
					if err != nil {
						b.Fatal(err)
					}
					if usage[mediaIDs[0]].Total != publicationCount/5 {
						b.Fatalf("unexpected usage: %+v", usage[mediaIDs[0]])
					}
				}
			})
		}
	}
}
