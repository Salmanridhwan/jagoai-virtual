package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/posttext"
	"github.com/uptrace/bun"
)

type SavedMentionResponse struct {
	ID       string                    `json:"id"`
	Name     string                    `json:"name"`
	Profiles []posttext.MentionProfile `json:"profiles"`
}
type SavedMentionListInput struct {
	WorkspaceID string `path:"workspace_id"`
}
type SavedMentionListOutput struct{ Body []SavedMentionResponse }
type SavedMentionSaveInput struct {
	WorkspaceID string `path:"workspace_id"`
	Body        struct {
		ID       string                    `json:"id,omitempty"`
		Name     string                    `json:"name" minLength:"2" maxLength:"80"`
		Profiles []posttext.MentionProfile `json:"profiles" minItems:"1" maxItems:"32"`
	}
}
type SavedMentionOutput struct{ Body SavedMentionResponse }
type SavedMentionDeleteInput struct {
	WorkspaceID string `path:"workspace_id"`
	ID          string `path:"id"`
}

var savedMentionName = regexp.MustCompile(`^@[\p{L}\p{N}_.-]{1,79}$`)

func RegisterSavedMentionRoutes(api huma.API, db *bun.DB, auth middleware.Authenticator) {
	h := savedMentionHandler{db: db}

	path := "/workspaces/{workspace_id}/mentions"
	middlewares := huma.Middlewares{middleware.AuthMiddleware(api, auth)}
	huma.Register(api, huma.Operation{OperationID: "list-saved-mentions", Method: http.MethodGet, Path: path, Summary: "List reusable Workspace mentions", Tags: []string{tagWorkspaces}, Middlewares: middlewares, Errors: []int{403, 500}}, h.list)
	huma.Register(api, huma.Operation{OperationID: "save-saved-mention", Method: http.MethodPost, Path: path, Summary: "Save a reusable Workspace mention", Tags: []string{tagWorkspaces}, Middlewares: middlewares, MaxBodyBytes: 32 * 1024, Errors: []int{400, 403, 404, 409, 500}}, h.save)
	huma.Register(api, huma.Operation{OperationID: "delete-saved-mention", Method: http.MethodDelete, Path: path + "/{id}", Summary: "Delete a saved mention without changing existing posts", Tags: []string{tagWorkspaces}, Middlewares: middlewares, Errors: []int{403, 404, 500}}, h.delete)
}

type savedMentionHandler struct{ db *bun.DB }

func (h savedMentionHandler) access(ctx context.Context, workspace string, edit bool) error {
	if workspace == "" {
		return huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	var allowed bool
	var err error
	if edit {
		allowed, err = workspaceEditAllowed(ctx, h.db, workspace, middleware.GetUserID(ctx))
	} else {
		allowed, err = workspaceReadAllowed(ctx, h.db, workspace, middleware.GetUserID(ctx))
	}
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h savedMentionHandler) list(ctx context.Context, input *SavedMentionListInput) (*SavedMentionListOutput, error) {
	if err := h.access(ctx, input.WorkspaceID, false); err != nil {
		return nil, err
	}
	var rows []models.SavedMention
	if err := h.db.NewSelect().Model(&rows).Where("workspace_id = ?", input.WorkspaceID).Order("name_key ASC").Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("could not load saved mentions")
	}
	out := &SavedMentionListOutput{Body: []SavedMentionResponse{}}
	for _, row := range rows {
		var profiles []posttext.MentionProfile
		if err := json.Unmarshal([]byte(row.ProfileJSON), &profiles); err != nil {
			return nil, huma.Error500InternalServerError("could not read saved mention")
		}
		out.Body = append(out.Body, SavedMentionResponse{ID: row.ID, Name: row.Name, Profiles: profiles})
	}
	return out, nil
}

func (h savedMentionHandler) save(ctx context.Context, input *SavedMentionSaveInput) (*SavedMentionOutput, error) {
	if err := h.access(ctx, input.WorkspaceID, true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if !savedMentionName.MatchString(name) {
		return nil, huma.Error400BadRequest("Use @ followed by letters, numbers, dots, underscores or hyphens")
	}
	id := input.Body.ID
	if id == "" {
		id = uuid.NewString()
	}
	if err := posttext.ValidateProfiles(posttext.MentionTarget{Provider: "workspace", Kind: "profile", ID: id, Profiles: input.Body.Profiles}); err != nil {
		return nil, huma.Error400BadRequest("invalid mention mappings", err)
	}
	encoded, _ := json.Marshal(input.Body.Profiles)
	row := models.SavedMention{ID: id, WorkspaceID: input.WorkspaceID, Name: name, NameKey: strings.ToLower(name), ProfileJSON: string(encoded), UpdatedAt: time.Now()}
	var duplicate models.SavedMention
	err := h.db.NewSelect().Model(&duplicate).Where("workspace_id = ? AND name_key = ? AND id <> ?", row.WorkspaceID, row.NameKey, row.ID).Scan(ctx)
	if err == nil {
		return nil, huma.Error409Conflict("A saved mention already uses this name")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error500InternalServerError("could not check saved mention")
	}
	if input.Body.ID == "" {
		_, err = h.db.NewInsert().Model(&row).Exec(ctx)
	} else {
		var result sql.Result
		result, err = h.db.NewUpdate().Model(&row).Column("name", "name_key", "profile_json", "updated_at").Where("id = ? AND workspace_id = ?", id, input.WorkspaceID).Exec(ctx)
		if err == nil {
			count, _ := result.RowsAffected()
			if count == 0 {
				return nil, huma.Error404NotFound("saved mention not found")
			}
		}
	}
	if err != nil {
		if conflict := h.db.NewSelect().Model((*models.SavedMention)(nil)).Where("workspace_id = ? AND name_key = ? AND id <> ?", row.WorkspaceID, row.NameKey, row.ID).Scan(ctx, new(models.SavedMention)); conflict == nil {
			return nil, huma.Error409Conflict("A saved mention already uses this name")
		}
		return nil, huma.Error500InternalServerError("Could not save this mention. Refresh and try again.")
	}
	return &SavedMentionOutput{Body: SavedMentionResponse{ID: id, Name: name, Profiles: input.Body.Profiles}}, nil
}

func (h savedMentionHandler) delete(ctx context.Context, input *SavedMentionDeleteInput) (*struct{}, error) {
	if err := h.access(ctx, input.WorkspaceID, true); err != nil {
		return nil, err
	}
	result, err := h.db.NewDelete().Model((*models.SavedMention)(nil)).Where("id = ? AND workspace_id = ?", input.ID, input.WorkspaceID).Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("could not delete saved mention")
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return nil, huma.Error404NotFound("saved mention not found")
	}
	return &struct{}{}, nil
}
