package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/imageprepare"
	"github.com/openpost/backend/internal/models"
)

type OptimizeMediaImageInput struct {
	PathID string `path:"id" doc:"Original image ID"`
}
type OptimizeMediaImageOutput struct {
	Body struct {
		Media     MediaUploadResult `json:"media"`
		Optimized bool              `json:"optimized" doc:"True only when a smaller lossless copy was created or reused"`
	}
}

func (h *MediaHandler) registerMediaImagePreparation(api huma.API) {
	h.registerMediaImageFit(api)
	huma.Register(api, huma.Operation{OperationID: "optimize-media-image", Method: http.MethodPost, Path: "/media/{id}/optimize-image", Summary: "Create a smaller lossless image copy while retaining the original", Tags: []string{tagMedia}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)}, Errors: []int{403, 404, 413, 422, 500}}, h.optimizeMediaImage)
}
func (h *MediaHandler) optimizeMediaImage(ctx context.Context, input *OptimizeMediaImageInput) (*OptimizeMediaImageOutput, error) {
	var original models.MediaAttachment
	if err := h.db.NewSelect().Model(&original).Where("id = ? AND trashed_at IS NULL", input.PathID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		return nil, huma.Error500InternalServerError("Could not read image")
	}
	if err := h.ensureMediaWorkspaceEditAccess(ctx, middleware.GetUserID(ctx), original.WorkspaceID); err != nil {
		return nil, err
	}
	output := &OptimizeMediaImageOutput{}
	output.Body.Media = mediaUploadResultFromAttachment(original, false)
	if original.MimeType != "image/png" || defaultMediaAssetKind(original.AssetKind) != "library" {
		return output, nil
	}
	if original.Size > MaxBufferedMediaUploadBytes {
		return output, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	content, err := h.readImageForPreparation(ctx, original)
	if err != nil {
		return nil, err
	}
	optimized, err := imageprepare.OptimizePNG(ctx, content)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity("Could not optimize this image without changing it")
	}
	if bytes.Equal(optimized, content) {
		return output, nil
	}
	hash := sha256.Sum256(optimized)
	var copy models.MediaAttachment
	err = h.db.NewSelect().Model(&copy).Where("workspace_id = ? AND parent_media_id = ? AND file_hash = ? AND source = 'image_optimization' AND trashed_at IS NULL", original.WorkspaceID, original.ID, hex.EncodeToString(hash[:])).Scan(ctx)
	if err == nil {
		output.Body.Media = mediaUploadResultFromAttachment(copy, true)
		output.Body.Optimized = true
		return output, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error500InternalServerError("Could not read optimized image")
	}
	var created models.MediaAttachment
	_, err = h.processUploadBytes(ctx, mediaUploadBytesInput{WorkspaceID: original.WorkspaceID, Filename: strings.TrimSuffix(original.OriginalFilename, filepath.Ext(original.OriginalFilename)) + "-optimized.png", DeclaredMimeType: "image/png", Content: optimized, Size: int64(len(optimized)), AltText: original.AltText, Source: "image_optimization", AssetKind: "library", RetentionClass: "temporary", ParentMediaID: original.ID, DesignDocumentID: original.DesignDocumentID, DesignPageID: original.DesignPageID, OnCreated: func(media models.MediaAttachment) { created = media }})
	if err != nil {
		return nil, huma.Error422UnprocessableEntity("Could not save optimized copy", err)
	}
	output.Body.Media = mediaUploadResultFromAttachment(created, false)
	output.Body.Optimized = true
	return output, nil
}

func (h *MediaHandler) readImageForPreparation(ctx context.Context, original models.MediaAttachment) ([]byte, error) {
	file, err := h.storage.Open(ctx, filepath.Base(original.FilePath))
	if err != nil {
		return nil, huma.Error500InternalServerError("Could not open image")
	}
	content, err := io.ReadAll(io.LimitReader(file, MaxBufferedMediaUploadBytes+1))
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return nil, huma.Error500InternalServerError("Could not read image")
	}
	if int64(len(content)) > MaxBufferedMediaUploadBytes {
		return nil, huma.Error413RequestEntityTooLarge("Image is too large to prepare")
	}
	return content, nil
}
