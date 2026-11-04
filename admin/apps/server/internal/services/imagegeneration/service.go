package imagegeneration

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type Service struct {
	db       *bun.DB
	provider ai.ImageProvider
	storage  mediastore.BlobStorage
	importer MediaImporter
}

func New(db *bun.DB, provider ai.ImageProvider, storage mediastore.BlobStorage, importer MediaImporter) *Service {
	return &Service{db, provider, storage, importer}
}
func (s *Service) Available() bool {
	return s != nil && s.provider != nil && s.storage != nil && s.importer != nil
}

func authorize(ctx context.Context, db bun.IDB, actor workspaceaccess.ActorFacts, workspaceID string, level workspaceaccess.Level) (workspaceaccess.StoredAuthority, error) {
	decision, err := workspaceaccess.NewAuthorizer(db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return workspaceaccess.StoredAuthority{}, err
	}
	if !decision.Allowed {
		return workspaceaccess.StoredAuthority{}, ErrAccess
	}
	return workspaceaccess.StoredAuthority{UserID: actor.UserID, WorkspaceID: workspaceID, OrganizationID: decision.OrganizationID, IdentityProviderID: decision.ProviderID, AssuredAt: time.Now().UTC()}, nil
}

func (s *Service) Create(ctx context.Context, actor workspaceaccess.ActorFacts, key string, request ImageGenerationRequest) (ImageGenerationRun, error) {
	if !s.Available() {
		return ImageGenerationRun{}, ErrUnavailable
	}
	request.Prompt = strings.TrimSpace(request.Prompt)
	if err := validate(request); err != nil || len(key) < 8 || len(key) > 160 {
		return ImageGenerationRun{}, ErrInvalid
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return ImageGenerationRun{}, err
	}
	hash := sha256.Sum256(encoded)
	fingerprint := hex.EncodeToString(hash[:])
	var stored record
	err = s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		authority, err := authorize(ctx, tx, actor, request.WorkspaceID, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		// Serialize admission for duplicate browser submissions on SQLite and PostgreSQL.
		if _, err = tx.ExecContext(ctx, "UPDATE users SET id = id WHERE id = ?", actor.UserID); err != nil {
			return err
		}
		err = tx.NewSelect().Model(&stored).Where("user_id = ? AND workspace_id = ? AND idempotency_key = ?", actor.UserID, request.WorkspaceID, key).Scan(ctx)
		if err == nil {
			if stored.Fingerprint != fingerprint {
				return ErrConflict
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err = s.checkSource(ctx, tx, request); err != nil {
			return err
		}
		proof, err := json.Marshal(authority)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		stored = record{ID: uuid.NewString(), WorkspaceID: request.WorkspaceID, UserID: actor.UserID, ProjectID: request.ProjectID, IdempotencyKey: key, Fingerprint: fingerprint, RequestJSON: string(encoded), AuthorityJSON: string(proof), SourceMediaID: request.SourceMediaID, Endpoint: ai.ImageEndpoint(request.Model, request.Operation != "generate"), State: "queued", BillingState: "pending", CreatedAt: now, UpdatedAt: now}
		if _, err = tx.NewInsert().Model(&stored).Exec(ctx); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"run_id": stored.ID})
		job, err := jobregistry.NewJob(jobregistry.TypeImageGeneration, string(payload), now)
		if err != nil {
			return err
		}
		_, err = tx.NewInsert().Model(job).Exec(ctx)
		return err
	})
	return project(stored), err
}

func (s *Service) checkSource(ctx context.Context, db bun.IDB, request ImageGenerationRequest) error {
	if request.SourceMediaID == "" {
		return nil
	}
	var source models.MediaAttachment
	err := db.NewSelect().Model(&source).Where("id = ? AND workspace_id = ?", request.SourceMediaID, request.WorkspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrAccess
	}
	if err != nil {
		return err
	}
	if !source.TrashedAt.IsZero() || source.ProcessingStatus != "ready" || source.AssetKind != "library" {
		return ErrAccess
	}
	if source.Size > 32*1024*1024 || source.Width <= 0 || source.Height <= 0 || int64(source.Width)*int64(source.Height) > 16_000_000 {
		return ErrInvalid
	}
	switch source.MimeType {
	case "image/png", "image/jpeg", "image/webp":
	default:
		return ErrInvalid
	}
	return nil
}

func (s *Service) Get(ctx context.Context, actor workspaceaccess.ActorFacts, id string) (ImageGenerationRun, error) {
	var stored record
	err := s.db.NewSelect().Model(&stored).Where("id = ? AND user_id = ?", id, actor.UserID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return ImageGenerationRun{}, ErrNotFound
	}
	if err != nil {
		return ImageGenerationRun{}, err
	}
	if _, err = authorize(ctx, s.db, actor, stored.WorkspaceID, workspaceaccess.LevelRead); err != nil {
		return ImageGenerationRun{}, err
	}
	return project(stored), nil
}

func (s *Service) List(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectID string) ([]ImageGenerationRun, error) {
	if _, err := authorize(ctx, s.db, actor, workspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	var records []record
	if err := s.db.NewSelect().Model(&records).Where("workspace_id = ? AND user_id = ? AND project_id = ?", workspaceID, actor.UserID, projectID).Order("created_at DESC").Limit(30).Scan(ctx); err != nil {
		return nil, err
	}
	runs := make([]ImageGenerationRun, 0, len(records))
	for _, item := range records {
		runs = append(runs, project(item))
	}
	return runs, nil
}

func project(stored record) ImageGenerationRun {
	var request ImageGenerationRequest
	_ = json.Unmarshal([]byte(stored.RequestJSON), &request)
	return ImageGenerationRun{SourceMediaID: stored.SourceMediaID, ID: stored.ID, WorkspaceID: stored.WorkspaceID, ProjectID: stored.ProjectID, PageID: request.PageID, Operation: request.Operation, Prompt: request.Prompt, Model: request.Model, State: stored.State, ErrorMessage: stored.ErrorMessage, ResultMediaID: stored.ResultMediaID, TargetLayerID: request.TargetLayerID, TargetFingerprint: request.TargetFingerprint, CostMicrousd: stored.CostMicrousd, BillingState: stored.BillingState, CreatedAt: stored.CreatedAt}
}
