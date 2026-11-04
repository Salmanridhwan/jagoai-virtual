package handlers

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestImageEditorAnimationAndLensEffectsSurviveSaveReloadAndRevision(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{ID: "source-gif", WorkspaceID: "workspace-1", FilePath: "source.gif", MimeType: "image/gif", ProcessingStatus: mediaReadyStatus, OriginalFilename: "source.gif", FileHash: "source-gif-hash", AssetKind: "library"}).Exec(ctx)
	require.NoError(t, err)
	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)
	update := &UpdateImageEditorDesignInput{PathID: created.Body.ID}
	update.Body.ExpectedRevision = created.Body.Revision
	update.Body.Document = created.Body.Document
	update.Body.Document.ExportDefaults.Format = "gif"
	image := &ImageEditorImageValue{MediaID: "source-gif", SourceWidth: 16, SourceHeight: 12, Fit: "stretch", Crop: ImageEditorCrop{Width: 1, Height: 1}, ColorGradeVersion: 1,
		LensEffect: &ImageEditorLensEffect{Kind: "starburst", Amount: 0.5, Threshold: 0.75, Size: 0.3, Angle: 20, Blades: 6},
		Animation:  &ImageEditorAnimation{SourceFrameCount: 3, Repeat: 0, Frames: []ImageEditorAnimationFrame{{SourceIndex: 2, DurationMS: 200}, {SourceIndex: 0, DurationMS: 100}}},
	}
	update.Body.Document.Pages[0].Layers = []ImageEditorLayer{{ID: "gif-layer", Type: "image", Name: "GIF", Visible: true, Opacity: 1, Transform: ImageEditorTransform{Width: 320, Height: 240}, Image: image}}
	updated, err := handler.updateDesign(ctx, update)
	require.NoError(t, err)
	loaded, err := handler.getDesign(ctx, &GetImageEditorDesignInput{PathID: created.Body.ID})
	require.NoError(t, err)
	require.Equal(t, "gif", loaded.Body.Document.ExportDefaults.Format)
	require.Equal(t, image, loaded.Body.Document.Pages[0].Layers[0].Image)
	require.Greater(t, updated.Body.Revision, created.Body.Revision)

	for _, invalid := range []ImageEditorAnimation{
		{SourceFrameCount: 3, Repeat: 0, Frames: []ImageEditorAnimationFrame{{SourceIndex: 3, DurationMS: 100}}},
		{SourceFrameCount: 3, Repeat: 0, Frames: []ImageEditorAnimationFrame{{SourceIndex: 0, DurationMS: 21}}},
		{SourceFrameCount: 3, Repeat: -2, Frames: []ImageEditorAnimationFrame{{SourceIndex: 0, DurationMS: 100}}},
	} {
		image.Animation = &invalid
		update.Body.ExpectedRevision = loaded.Body.Revision
		_, err := handler.updateDesign(ctx, update)
		require.Error(t, err)
	}
	image.Animation = nil
	image.LensEffect.Amount = 2
	_, err = handler.updateDesign(ctx, update)
	require.Error(t, err)
}
