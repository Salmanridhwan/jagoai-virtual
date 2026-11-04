package handlers

import (
	"bytes"
	"context"

	"github.com/openpost/backend/internal/imageprepare"
	"github.com/openpost/backend/internal/services/mediastore"
)

// Encoding and decoded-image admission finished inside the killable worker.
// The upload owner persists those bytes with the ordinary storage lifecycle.
func (h *MediaHandler) persistPreparedThumbnails(ctx context.Context, mediaID string, prepared *imageprepare.Prepared) Thumbnails {
	var thumbnails Thumbnails
	for _, thumbnail := range prepared.Thumbnails {
		extension := ".jpg"
		if thumbnail.MIME == "image/png" {
			extension = ".png"
		}
		filename := thumbnail.Size + "_" + mediaID + extension
		if _, err := mediastore.SaveWithContentType(ctx, h.storage, filename, bytes.NewReader(thumbnail.Data), thumbnail.MIME); err != nil {
			_ = mediastore.DeleteForCleanup(ctx, h.storage, filename)
			continue
		}
		switch thumbnail.Size {
		case "sm":
			thumbnails.SM = filename
		case "md":
			thumbnails.MD = filename
		}
	}
	return thumbnails
}
