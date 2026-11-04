package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/appbranding"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
)

type AppBrandingHandler struct {
	auth    middleware.Authenticator
	service *appbranding.Service
}

func NewAppBrandingHandler(db *bun.DB, auth middleware.Authenticator, storage mediastore.BlobStorage) *AppBrandingHandler {
	return &AppBrandingHandler{auth: auth, service: appbranding.New(db, storage)}
}

type AppBrandingInput struct {
	WorkspaceID string `path:"workspace_id"`
}
type UpdateAppBrandingInput struct {
	WorkspaceID string `path:"workspace_id"`
	Body        appbranding.Update
}
type AppBrandingOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         appbranding.Settings
}
type AppBrandingImageInput struct {
	WorkspaceID         string `path:"workspace_id"`
	ID                  string `path:"id"`
	OrganizationDefault bool   `query:"organization_default"`
}
type AppBrandingImageOutput struct {
	ContentType         string `header:"Content-Type"`
	CacheControl        string `header:"Cache-Control"`
	XContentTypeOptions string `header:"X-Content-Type-Options"`
	Body                []byte
}

func (h *AppBrandingHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	path := "/app-branding/{workspace_id}"
	huma.Register(api, huma.Operation{OperationID: "get-app-branding", Method: http.MethodGet, Path: path, Summary: "Get effective app branding and inheritance", Tags: []string{"App Branding"}, Middlewares: auth, Errors: []int{403, 503}}, h.get)
	huma.Register(api, huma.Operation{OperationID: "update-organization-app-branding", Method: http.MethodPut, Path: path + "/organization", Summary: "Set organization app branding and workspace policy", Tags: []string{"App Branding"}, Middlewares: auth, MaxBodyBytes: 6 * 1024 * 1024, Errors: []int{400, 403, 409, 503}}, h.saveOrganization)
	huma.Register(api, huma.Operation{OperationID: "update-workspace-app-branding", Method: http.MethodPut, Path: path + "/workspace", Summary: "Set workspace app branding or restore inheritance", Tags: []string{"App Branding"}, Middlewares: auth, MaxBodyBytes: 6 * 1024 * 1024, Errors: []int{400, 403, 409, 503}}, h.saveWorkspace)
	huma.Register(api, huma.Operation{OperationID: "get-app-branding-image", Method: http.MethodGet, Path: path + "/images/{id}", Summary: "Read an authorized app branding image", Responses: map[string]*huma.Response{"200": {Description: "PNG branding image", Content: map[string]*huma.MediaType{"image/png": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}}, Tags: []string{"App Branding"}, Middlewares: auth, Errors: []int{403, 503}}, h.image)
}
func brandingActor(ctx context.Context) appbranding.Actor {
	return appbranding.Actor{UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx), ClientID: middleware.GetClientID(ctx), CredentialWorkspaceID: middleware.GetWorkspaceID(ctx)}
}
func brandingError(err error) error {
	switch {
	case errors.Is(err, appbranding.ErrDenied):
		return huma.Error403Forbidden("App branding access denied")
	case errors.Is(err, appbranding.ErrInvalid):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, appbranding.ErrConflict), errors.Is(err, appbranding.ErrLocked):
		return huma.Error409Conflict(err.Error())
	default:
		return huma.Error503ServiceUnavailable("App branding unavailable")
	}
}
func (h *AppBrandingHandler) get(ctx context.Context, input *AppBrandingInput) (*AppBrandingOutput, error) {
	settings, err := h.service.Settings(ctx, brandingActor(ctx), input.WorkspaceID)
	if err != nil {
		return nil, brandingError(err)
	}
	return &AppBrandingOutput{CacheControl: "private, no-store", Body: settings}, nil
}
func (h *AppBrandingHandler) save(ctx context.Context, input *UpdateAppBrandingInput, organization bool) (*AppBrandingOutput, error) {
	settings, err := h.service.Save(ctx, brandingActor(ctx), input.WorkspaceID, organization, input.Body)
	if err != nil {
		return nil, brandingError(err)
	}
	return &AppBrandingOutput{CacheControl: "private, no-store", Body: settings}, nil
}
func (h *AppBrandingHandler) saveOrganization(ctx context.Context, input *UpdateAppBrandingInput) (*AppBrandingOutput, error) {
	return h.save(ctx, input, true)
}
func (h *AppBrandingHandler) saveWorkspace(ctx context.Context, input *UpdateAppBrandingInput) (*AppBrandingOutput, error) {
	return h.save(ctx, input, false)
}
func (h *AppBrandingHandler) image(ctx context.Context, input *AppBrandingImageInput) (*AppBrandingImageOutput, error) {
	content, err := h.service.OpenImage(ctx, brandingActor(ctx), input.WorkspaceID, input.ID, input.OrganizationDefault)
	if err != nil {
		return nil, brandingError(err)
	}
	return &AppBrandingImageOutput{ContentType: "image/png", CacheControl: "private, no-store", XContentTypeOptions: "nosniff", Body: content}, nil
}
