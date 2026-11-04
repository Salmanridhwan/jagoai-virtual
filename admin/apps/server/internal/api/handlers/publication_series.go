package handlers

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

type PublicationSeriesConceptInput struct {
	PathID string `path:"id"`
	ItemID string `path:"item_id"`
	Body   struct {
		ExpectedRevision int    `json:"expected_revision" minimum:"1"`
		Title            string `json:"title" minLength:"1" maxLength:"200"`
		Brief            string `json:"brief" minLength:"1" maxLength:"1500"`
	}
}
type StartPublicationSeriesConceptInput struct {
	PathID string `path:"id"`
	ItemID string `path:"item_id"`
	Body   struct {
		ExpectedRevision int `json:"expected_revision" minimum:"1"`
	}
}
type seriesApplication interface {
	UpdateSeriesConcept(context.Context, string, string, string, int, string, string) (publicationbuilder.Build, error)
	StartSeriesConcept(context.Context, string, string, string, int) (publicationbuilder.Build, error)
}

func (h *PublicationBuildHandler) registerSeriesRoutes(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "update-series-concept", Method: http.MethodPut, Path: publicationBuildsPath + "/{id}/series/{item_id}", Summary: "Edit a series concept before generating its post", Tags: []string{publicationBuildsTag}, MaxBodyBytes: 16384, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, func(ctx context.Context, input *PublicationSeriesConceptInput) (*PublicationBuildOutput, error) {
		if _, err := h.loadAuthorizedBuild(ctx, input.PathID, workspaceaccess.LevelEdit); err != nil {
			return nil, err
		}
		application, ok := h.application.(seriesApplication)
		if !ok {
			return nil, huma.Error503ServiceUnavailable("Series generation is unavailable")
		}
		build, err := application.UpdateSeriesConcept(ctx, middleware.GetUserID(ctx), input.PathID, input.ItemID, input.Body.ExpectedRevision, input.Body.Title, input.Body.Brief)
		if err != nil {
			return nil, publicationBuildError(err)
		}
		return &PublicationBuildOutput{Body: build}, nil
	})
	huma.Register(api, huma.Operation{OperationID: "generate-series-post", Method: http.MethodPost, Path: publicationBuildsPath + "/{id}/series/{item_id}/generate", Summary: "Generate one explicitly selected series post", Tags: []string{publicationBuildsTag}, MaxBodyBytes: 4096, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, func(ctx context.Context, input *StartPublicationSeriesConceptInput) (*PublicationBuildOutput, error) {
		if _, err := h.loadAuthorizedBuild(ctx, input.PathID, workspaceaccess.LevelEdit); err != nil {
			return nil, err
		}
		application, ok := h.application.(seriesApplication)
		if !ok {
			return nil, huma.Error503ServiceUnavailable("Series generation is unavailable")
		}
		build, err := application.StartSeriesConcept(ctx, middleware.GetUserID(ctx), input.PathID, input.ItemID, input.Body.ExpectedRevision)
		if err != nil {
			return nil, publicationBuildError(err)
		}
		return &PublicationBuildOutput{Body: build}, nil
	})
}
