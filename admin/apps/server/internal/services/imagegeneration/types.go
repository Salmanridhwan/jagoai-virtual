package imagegeneration

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

var (
	ErrAccess         = errors.New("image generation access denied")
	ErrInvalid        = errors.New("invalid image generation request")
	ErrNotFound       = errors.New("image generation not found")
	ErrConflict       = errors.New("image generation request conflict")
	ErrUnavailable    = errors.New("image generation unavailable")
	ErrPending        = errors.New("image generation awaiting provider")
	ErrBillingPending = fmt.Errorf("%w: billing", ErrPending)
)

//nolint:revive // This name identifies the request in the shared API schema.
type ImageGenerationRequest struct {
	WorkspaceID       string `json:"workspace_id" minLength:"1" maxLength:"200"`
	ProjectID         string `json:"project_id" minLength:"1" maxLength:"200"`
	PageID            string `json:"page_id" minLength:"1" maxLength:"200"`
	Operation         string `json:"operation" enum:"generate,edit,fill"`
	Prompt            string `json:"prompt" minLength:"1" maxLength:"8000"`
	Model             string `json:"model" enum:"gpt-image-2.5-flare,gpt-image-2.5-sunburst"`
	Quality           string `json:"quality" enum:"low,medium,high,xhigh,max,auto"`
	Size              string `json:"size" enum:"square_hd,portrait_4_3,portrait_16_9,landscape_4_3,landscape_16_9,auto"`
	Background        string `json:"background" enum:"auto,opaque,transparent"`
	SourceMediaID     string `json:"source_media_id,omitempty" maxLength:"200"`
	MaskPNG           string `json:"mask_png,omitempty" maxLength:"5592408" doc:"Base64 PNG; transparent pixels are selected. Fill only."`
	TargetLayerID     string `json:"target_layer_id,omitempty" maxLength:"200"`
	TargetFingerprint string `json:"target_fingerprint,omitempty" maxLength:"100" doc:"Browser snapshot fingerprint used to prevent stale application"`
}

//nolint:revive // This name identifies the run in the shared API schema.
type ImageGenerationRun struct {
	SourceMediaID     string    `json:"source_media_id"`
	ID                string    `json:"id"`
	WorkspaceID       string    `json:"workspace_id"`
	ProjectID         string    `json:"project_id"`
	PageID            string    `json:"page_id"`
	Operation         string    `json:"operation"`
	Prompt            string    `json:"prompt"`
	Model             string    `json:"model"`
	State             string    `json:"state"`
	ErrorMessage      string    `json:"error_message"`
	ResultMediaID     string    `json:"result_media_id"`
	TargetLayerID     string    `json:"target_layer_id"`
	TargetFingerprint string    `json:"target_fingerprint"`
	CostMicrousd      *int64    `json:"cost_microusd"`
	BillingState      string    `json:"billing_state"`
	CreatedAt         time.Time `json:"created_at"`
}

type record struct {
	bun.BaseModel                                                                           `bun:"table:image_generation_runs"`
	ID                                                                                      string `bun:",pk"`
	WorkspaceID, UserID, ProjectID, IdempotencyKey, Fingerprint, RequestJSON, AuthorityJSON string
	SourceMediaID                                                                           string `bun:",nullzero"`
	ResultMediaID                                                                           string `bun:",nullzero"`
	Endpoint, ProviderRequestID, State, ErrorMessage, BillingState                          string
	CostMicrousd                                                                            *int64
	LeaseToken                                                                              string
	LeaseExpiresAt                                                                          *time.Time
	CreatedAt, UpdatedAt                                                                    time.Time
}

type MediaImport struct {
	WorkspaceID, ParentMediaID, ProjectID, PageID, RunID, Recipe string
	Content                                                      []byte
}
type MediaImporter interface {
	ImportGeneratedImage(context.Context, MediaImport) (models.MediaAttachment, error)
}
