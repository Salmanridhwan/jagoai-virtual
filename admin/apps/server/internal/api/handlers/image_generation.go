package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/imagegeneration"
)

type ImageGenerationHandler struct {
	service *imagegeneration.Service
	auth    middleware.Authenticator
}

func NewImageGenerationHandler(service *imagegeneration.Service, auth middleware.Authenticator) *ImageGenerationHandler {
	return &ImageGenerationHandler{service, auth}
}

type CreateImageGenerationInput struct {
	IdempotencyKey string `header:"Idempotency-Key" required:"true" minLength:"8" maxLength:"160"`
	Body           imagegeneration.ImageGenerationRequest
}
type ImageGenerationOutput struct {
	Body imagegeneration.ImageGenerationRun
}
type GetImageGenerationInput struct {
	ID string `path:"id" maxLength:"200"`
}
type ListImageGenerationsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" maxLength:"200"`
	ProjectID   string `query:"project_id" required:"true" maxLength:"200"`
}
type ListImageGenerationsOutput struct {
	Body struct {
		Runs []imagegeneration.ImageGenerationRun `json:"runs"`
	}
}
type ImageGenerationConfigOutput struct {
	Body struct {
		Available    bool            `json:"available"`
		DefaultModel string          `json:"default_model"`
		Models       []ai.ImageModel `json:"models"`
	}
}

func (h *ImageGenerationHandler) RegisterRoutes(api huma.API) {
	op := func(id, method, path, summary string) huma.Operation {
		return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Tags: []string{"Image generation"}, MaxBodyBytes: 6 * 1024 * 1024, Errors: []int{400, 403, 404, 409, 503}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}
	}
	huma.Register(api, op("image-generation-config", http.MethodGet, "/image-generations/config", "Read signed-in image generation capabilities"), h.config)
	huma.Register(api, op("create-image-generation", http.MethodPost, "/image-generations", "Generate, edit or fill an image for review"), h.create)
	huma.Register(api, op("get-image-generation", http.MethodGet, "/image-generations/{id}", "Read a saved image generation request"), h.get)
	huma.Register(api, op("list-image-generations", http.MethodGet, "/image-generations", "Read the current user's image generation history"), h.list)
}
func (h *ImageGenerationHandler) config(_ context.Context, _ *struct{}) (*ImageGenerationConfigOutput, error) {
	out := &ImageGenerationConfigOutput{}
	out.Body.Available, out.Body.DefaultModel, out.Body.Models = h.service.Available(), ai.DefaultImageModel, ai.ImageModels()
	return out, nil
}
func (h *ImageGenerationHandler) create(ctx context.Context, input *CreateImageGenerationInput) (*ImageGenerationOutput, error) {
	if h.service == nil {
		return nil, imageGenerationError(imagegeneration.ErrUnavailable)
	}
	run, err := h.service.Create(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.IdempotencyKey, input.Body)
	return &ImageGenerationOutput{Body: run}, imageGenerationError(err)
}
func (h *ImageGenerationHandler) get(ctx context.Context, input *GetImageGenerationInput) (*ImageGenerationOutput, error) {
	if h.service == nil {
		return nil, imageGenerationError(imagegeneration.ErrUnavailable)
	}
	run, err := h.service.Get(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.ID)
	return &ImageGenerationOutput{Body: run}, imageGenerationError(err)
}
func (h *ImageGenerationHandler) list(ctx context.Context, input *ListImageGenerationsInput) (*ListImageGenerationsOutput, error) {
	if h.service == nil {
		return nil, imageGenerationError(imagegeneration.ErrUnavailable)
	}
	runs, err := h.service.List(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.WorkspaceID, input.ProjectID)
	out := &ListImageGenerationsOutput{}
	out.Body.Runs = runs
	return out, imageGenerationError(err)
}
func imageGenerationError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, imagegeneration.ErrInvalid):
		return huma.Error400BadRequest("Check the image, selection, prompt and generation settings")
	case errors.Is(err, imagegeneration.ErrAccess):
		return huma.Error403Forbidden("This workspace or source is not available for image generation")
	case errors.Is(err, imagegeneration.ErrNotFound):
		return huma.Error404NotFound("Image generation not found")
	case errors.Is(err, imagegeneration.ErrConflict):
		return huma.Error409Conflict("This request key was already used with different settings")
	default:
		return huma.Error503ServiceUnavailable("Image generation is unavailable. Try again later")
	}
}

// ImportGeneratedImage uses the ordinary Media admission, quota, thumbnail and
// deduplication path. Durable retries reuse the bytes and never buy another image.
func (h *MediaHandler) ImportGeneratedImage(ctx context.Context, input imagegeneration.MediaImport) (models.MediaAttachment, error) {
	mediaID := uuid.NewSHA1(uuid.NameSpaceURL, []byte("openpost:image-generation:"+input.WorkspaceID+":"+input.RunID)).String()
	result, err := h.processUploadBytes(ctx, mediaUploadBytesInput{StableID: mediaID, WorkspaceID: input.WorkspaceID, Filename: "ai-image-" + input.RunID + ".png", DeclaredMimeType: "image/png", Content: input.Content, Source: "image_generation", AssetKind: "library", RetentionClass: "library", ParentMediaID: input.ParentMediaID})
	if err != nil {
		return models.MediaAttachment{}, err
	}
	id, _ := result["id"].(string)
	var media models.MediaAttachment
	if err = h.db.NewSelect().Model(&media).Where("id = ? AND workspace_id = ?", id, input.WorkspaceID).Scan(ctx); err != nil {
		return media, err
	}
	recipe := models.MediaGenerationRecipe{MediaID: id, WorkspaceID: input.WorkspaceID, Kind: "ai_image", RendererKey: "fal", TemplateID: input.RunID, RecipeJSON: input.Recipe, CreatedAt: time.Now().UTC()}
	_, err = h.db.NewInsert().Model(&recipe).On("CONFLICT (media_id) DO NOTHING").Exec(ctx)
	return media, err
}
