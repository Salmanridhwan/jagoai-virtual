package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/imageprepare"
	"github.com/openpost/backend/internal/models"
)

type PrepareMediaImageBody struct {
	AltText       *string        `json:"alt_text,omitempty" maxLength:"2000" doc:"Optional alt text for the fitted copy"`
	AccountID     string         `json:"account_id" minLength:"1" doc:"Connected destination in the original image's Workspace"`
	OutputProfile string         `json:"output_profile" minLength:"1" doc:"Explicit destination format from resolve-capabilities"`
	Settings      map[string]any `json:"settings,omitempty" doc:"Destination settings used when resolving its limits"`
}
type PrepareMediaImageInput struct {
	PathID string `path:"id"`
	Body   PrepareMediaImageBody
}
type PrepareMediaImageOutput struct {
	Body struct {
		Media  MediaUploadResult `json:"media"`
		Status string            `json:"status" enum:"ready" doc:"The derivative is fully processed before returning. Select its media ID explicitly when authoring a post."`
	}
}

func (h *MediaHandler) SetCapabilityResolver(resolver *CapabilityResolverHandler) {
	h.capabilityResolver = resolver
}
func (h *MediaHandler) registerMediaImageFit(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "prepare-media-image", Method: http.MethodPost, Path: "/media/{id}/prepare-image", Summary: "Create a ready image copy fitted to a connected destination", Tags: []string{tagMedia}, MaxBodyBytes: 32 * 1024, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)}, Errors: []int{403, 404, 413, 422, 500, 503}}, h.prepareMediaImage)
}
func (h *MediaHandler) prepareMediaImage(ctx context.Context, input *PrepareMediaImageInput) (*PrepareMediaImageOutput, error) {
	return h.prepareImage(ctx, middleware.GetUserID(ctx), input.PathID, input.Body)
}

func (h *MediaHandler) prepareImage(ctx context.Context, userID, mediaID string, input PrepareMediaImageBody) (*PrepareMediaImageOutput, error) {
	if err := validatePrepareImageOptions(input); err != nil {
		return nil, err
	}
	original, account, err := h.loadImagePreparationSource(ctx, userID, mediaID, input.AccountID)
	if err != nil {
		return nil, err
	}
	if h.capabilityResolver == nil {
		return nil, huma.Error503ServiceUnavailable("Destination capability resolver is unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	resolve := capabilities.ResolveInput{RequestedOutputProfile: input.OutputProfile, Settings: input.Settings, Segments: []capabilities.ResolveSegment{{Media: []capabilities.MediaItem{{ID: original.ID, MimeType: original.MimeType, Size: original.Size, Width: original.Width, Height: original.Height}}}}}
	resolved, connectorBacked, err := h.capabilityResolver.resolveAccountCapability(ctx, account, "", "", resolve)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("Could not resolve destination image limits")
	}
	if !imagePreparationFormatAllowed(account.Platform, input.OutputProfile, resolved, connectorBacked) {
		return nil, huma.Error422UnprocessableEntity("This destination format does not accept images")
	}
	content, err := h.readImageForPreparation(ctx, original)
	if err != nil {
		return nil, err
	}
	prepared, err := imageprepare.Prepare(ctx, content, resolved.Media)
	if err != nil {
		if errors.Is(err, imageprepare.ErrAnimated) {
			return nil, huma.Error422UnprocessableEntity("Animated images cannot be fitted without losing frames")
		}
		return nil, huma.Error422UnprocessableEntity("Could not fit this image within destination limits")
	}
	altText := original.AltText
	if input.AltText != nil {
		altText = *input.AltText
	}
	derivative, err := h.saveFittedImage(ctx, original, prepared, altText)
	if err != nil {
		return nil, err
	}
	output := &PrepareMediaImageOutput{}
	output.Body.Media = mediaUploadResultFromAttachment(derivative, false)
	output.Body.Status = "ready"
	return output, nil
}

func (h *MediaHandler) saveFittedImage(ctx context.Context, original models.MediaAttachment, prepared *imageprepare.Prepared, altText string) (models.MediaAttachment, error) {
	fitted, mime := prepared.Content, prepared.MIME
	hash := sha256.Sum256(fitted)
	var derivative models.MediaAttachment
	err := h.db.NewSelect().Model(&derivative).Where("workspace_id = ? AND parent_media_id = ? AND file_hash = ? AND source = 'image_fit' AND alt_text = ? AND trashed_at IS NULL", original.WorkspaceID, original.ID, hex.EncodeToString(hash[:]), altText).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		ext := strings.TrimPrefix(mime, "image/")
		if ext == "jpeg" {
			ext = "jpg"
		}
		_, err = h.processUploadBytes(ctx, mediaUploadBytesInput{WorkspaceID: original.WorkspaceID, Filename: strings.TrimSuffix(original.OriginalFilename, filepath.Ext(original.OriginalFilename)) + "-fit." + ext, DeclaredMimeType: mime, Content: fitted, Size: int64(len(fitted)), AltText: altText, Source: "image_fit", AssetKind: "library", RetentionClass: "temporary", ParentMediaID: original.ID, DesignDocumentID: original.DesignDocumentID, DesignPageID: original.DesignPageID, PreparedImage: prepared, OnCreated: func(media models.MediaAttachment) { derivative = media }})
	}
	if err != nil {
		return models.MediaAttachment{}, huma.Error500InternalServerError("Could not save fitted copy")
	}
	return derivative, nil
}

func validatePrepareImageOptions(input PrepareMediaImageBody) error {
	if strings.TrimSpace(input.OutputProfile) == "" || len(input.AccountID) > 200 || len(input.OutputProfile) > 200 || input.AltText != nil && utf8.RuneCountInString(*input.AltText) > 2000 {
		return huma.Error422UnprocessableEntity("Invalid preparation options")
	}
	settingsJSON, err := json.Marshal(input.Settings)
	if err != nil || len(settingsJSON) > 16*1024 {
		return huma.Error422UnprocessableEntity("Destination settings are too large")
	}

	return nil
}
func (h *MediaHandler) loadImagePreparationSource(ctx context.Context, userID, mediaID, accountID string) (models.MediaAttachment, models.SocialAccount, error) {
	var original models.MediaAttachment
	if err := h.db.NewSelect().Model(&original).Where("id = ? AND trashed_at IS NULL", mediaID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.MediaAttachment{}, models.SocialAccount{}, huma.Error404NotFound(errMediaNotFound)
		}
		return models.MediaAttachment{}, models.SocialAccount{}, huma.Error500InternalServerError("Could not read image")
	}
	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, original.WorkspaceID); err != nil {
		return models.MediaAttachment{}, models.SocialAccount{}, err
	}
	var account models.SocialAccount
	if err := h.db.NewSelect().Model(&account).Where("id = ? AND workspace_id = ? AND is_active = ?", accountID, original.WorkspaceID, true).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.MediaAttachment{}, models.SocialAccount{}, huma.Error404NotFound("Destination account is not available in this Workspace")
		}
		return models.MediaAttachment{}, models.SocialAccount{}, huma.Error500InternalServerError("Could not read destination")
	}

	if defaultMediaAssetKind(original.AssetKind) != "library" || !strings.HasPrefix(original.MimeType, "image/") {
		return models.MediaAttachment{}, models.SocialAccount{}, huma.Error422UnprocessableEntity("Choose a library image")
	}
	if original.Size > MaxBufferedMediaUploadBytes {
		return models.MediaAttachment{}, models.SocialAccount{}, huma.Error413RequestEntityTooLarge("Image is too large to prepare")
	}
	return original, account, nil
}

// Account MIME limits refine a format; they cannot turn a video-only format
// into an image destination. Connector formats own their separate catalogue.
func imagePreparationFormatAllowed(provider, profile string, resolved capabilities.ResolvedCapability, connectorBacked bool) bool {
	if resolved.OutputProfile != profile || resolved.Media.MaxCount == 0 {
		return false
	}
	if connectorBacked {
		return true
	}
	for _, candidate := range capabilities.All() {
		if candidate.Provider != provider || candidate.OutputProfile != profile {
			continue
		}
		for _, mime := range candidate.Media.AllowedMIMEs {
			if strings.HasPrefix(mime, "image/") {
				return true
			}
		}
	}
	return false
}
