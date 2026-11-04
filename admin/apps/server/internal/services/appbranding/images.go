package appbranding

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg" // Accept JPEG uploads before normalizing them to PNG.
	"image/png"
	"io"
	"net/url"
	"path"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
	_ "golang.org/x/image/webp" // Accept WebP uploads before normalizing them to PNG.
)

const MaxImageBytes = 1024 * 1024

func images(p Profile) []*Image { return []*Image{p.Logo, p.DarkLogo, p.Wordmark, p.DarkWordmark} }
func objectKey(organizationID, id string) string {
	return path.Join("app-branding", organizationID, id+".png")
}
func withURLs(p Profile, workspaceID string, organization bool) Profile {
	// Copy image values, because effective and preview profiles have different URLs.
	slots := []**Image{&p.Logo, &p.DarkLogo, &p.Wordmark, &p.DarkWordmark}
	for _, slot := range slots {
		if *slot == nil {
			continue
		}
		img := **slot
		img.URL = "/api/v1/app-branding/" + url.PathEscape(workspaceID) + "/images/" + url.PathEscape(img.ID)
		if organization {
			img.URL += "?organization_default=true"
		}
		*slot = &img
	}
	return p
}
func hasImage(p Profile, id string) bool {
	if _, err := uuid.Parse(id); err != nil {
		return false
	}
	for _, img := range images(p) {
		if img != nil && img.ID == id {
			return true
		}
	}
	return false
}
func removedKeys(organizationID string, old, next Profile) []string {
	result := []string{}
	for _, img := range images(old) {
		if img != nil && !hasImage(next, img.ID) {
			result = append(result, objectKey(organizationID, img.ID))
		}
	}
	return result
}
func (s *Service) prepare(ctx context.Context, organizationID string, input *ProfileInput, old, org Profile, organization bool, created *[]string) (Profile, error) {
	name, err := normalizedName(input.DisplayName)
	if err != nil {
		return Profile{}, err
	}
	if input.DarkLogo != nil && input.Logo == nil || input.DarkWordmark != nil && input.Wordmark == nil {
		return Profile{}, fmt.Errorf("%w: add the default image before its dark variant", ErrInvalid)
	}
	result := Profile{DisplayName: name}
	inputs := []*ImageInput{input.Logo, input.DarkLogo, input.Wordmark, input.DarkWordmark}
	slots := []**Image{&result.Logo, &result.DarkLogo, &result.Wordmark, &result.DarkWordmark}
	for i, img := range inputs {
		if img == nil {
			continue
		}
		prepared, err := s.prepareImage(ctx, organizationID, img, old, org, organization, i < 2, created)
		if err != nil {
			return Profile{}, err
		}
		*slots[i] = prepared
	}
	return result, nil
}
func (s *Service) prepareImage(ctx context.Context, organizationID string, input *ImageInput, old, org Profile, organization, square bool, created *[]string) (*Image, error) {
	if input.ID != "" && input.ContentBase64 != "" {
		return nil, fmt.Errorf("%w: choose an existing image or an upload", ErrInvalid)
	}
	retained := input.ID != "" && hasImage(old, input.ID)
	if s.storage == nil {
		return nil, fmt.Errorf("branding image storage unavailable")
	}
	data, err := s.imageContent(ctx, organizationID, input, old, org, organization)
	if err != nil {
		return nil, err
	}
	if err = validateImage(data, square); err != nil {
		return nil, err
	}
	if retained {
		return &Image{ID: input.ID}, nil
	}
	normalized, err := normalizeImage(data)
	if err != nil {
		return nil, err
	}
	id := uuid.NewString()
	key := objectKey(organizationID, id)
	// Include failed/partial saves in cleanup as well.
	*created = append(*created, key)
	if _, err = s.storage.Save(ctx, key, bytes.NewReader(normalized)); err != nil {
		return nil, err
	}
	return &Image{ID: id}, nil
}
func (s *Service) imageContent(ctx context.Context, organizationID string, input *ImageInput, old, org Profile, organization bool) ([]byte, error) {
	var data []byte
	var err error
	if input.ID != "" {
		if !hasImage(old, input.ID) && (organization || !hasImage(org, input.ID)) {
			return nil, ErrDenied
		}
		reader, err := s.storage.Open(ctx, objectKey(organizationID, input.ID))
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		data, err = io.ReadAll(io.LimitReader(reader, MaxImageBytes+1))
		if err != nil {
			return nil, err
		}
	} else {
		if len(input.ContentBase64) > 1400000 {
			return nil, fmt.Errorf("%w: image exceeds 1 MiB", ErrInvalid)
		}
		data, err = base64.StdEncoding.DecodeString(input.ContentBase64)
	}
	if err != nil || len(data) == 0 || len(data) > MaxImageBytes {
		return nil, fmt.Errorf("%w: upload a PNG, JPEG or WebP up to 1 MiB", ErrInvalid)
	}
	return data, nil
}

func validateImage(data []byte, square bool) error {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("%w: image cannot be decoded", ErrInvalid)
	}
	switch format {
	case "png", "jpeg", "webp":
	default:
		return fmt.Errorf("%w: upload a PNG, JPEG or WebP", ErrInvalid)
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 2048 || config.Height > 2048 || square && config.Width != config.Height {
		return fmt.Errorf("%w: images must be at most 2048 pixels per side; logos must be square", ErrInvalid)
	}
	return nil
}

func normalizeImage(data []byte) ([]byte, error) {
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: image cannot be decoded", ErrInvalid)
	}
	var normalized bytes.Buffer
	if err = png.Encode(&normalized, decoded); err != nil {
		return nil, err
	}
	if normalized.Len() > MaxImageBytes {
		return nil, fmt.Errorf("%w: normalized image exceeds 1 MiB", ErrInvalid)
	}
	return normalized.Bytes(), nil
}

func (s *Service) cleanupUncommitted(ctx context.Context, keys []string) {
	if len(keys) == 0 {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	failed := []string{}
	for _, key := range keys {
		if err := mediastore.DeleteForCleanup(cleanupCtx, s.storage, key); err != nil {
			failed = append(failed, key)
		}
	}
	if len(failed) > 0 {
		_, _ = jobregistry.EnqueueStorageDeletes(cleanupCtx, s.db, failed)
	}
}

func (s *Service) OpenImage(ctx context.Context, actor Actor, workspaceID, id string, organizationDefault bool) ([]byte, error) {
	organizationID, err := authorize(ctx, s.db, actor, workspaceID, "read")
	if err != nil {
		return nil, err
	}
	profile, err := s.imageProfile(ctx, actor, organizationID, workspaceID, organizationDefault)
	if err != nil {
		return nil, err
	}

	if !hasImage(profile, id) {
		return nil, ErrDenied
	}
	if s.storage == nil {
		return nil, fmt.Errorf("branding image storage unavailable")
	}
	reader, err := s.storage.Open(ctx, objectKey(organizationID, id))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, MaxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxImageBytes {
		return nil, fmt.Errorf("branding image exceeds stored limit")
	}
	return data, nil
}

func (s *Service) imageProfile(ctx context.Context, actor Actor, organizationID, workspaceID string, organizationDefault bool) (Profile, error) {
	row, profile, err := load(ctx, s.db, organizationID, "")
	if err != nil {
		return Profile{}, err
	}
	if organizationDefault {
		admin, err := organizationAdmin(ctx, s.db, actor, organizationID)
		if err != nil {
			return Profile{}, err
		}
		if !admin {
			if _, err = authorize(ctx, s.db, actor, workspaceID, "administer"); err != nil {
				return Profile{}, err
			}
		}
	} else if row.AllowWorkspaceOverride {
		override, p, err := load(ctx, s.db, organizationID, workspaceID)
		if err != nil {
			return Profile{}, err
		}
		if override.Revision > 0 && override.ProfileJSON != "null" {
			profile = p
		}
	}
	return profile, nil
}

// StoredObjectKeys supplies the deletion owners with the exact committed blobs.
// Empty workspaceID selects the entire organization.
func StoredObjectKeys(ctx context.Context, db interface{ NewSelect() *bun.SelectQuery }, organizationID, workspaceID string) ([]string, error) {
	return storedKeys(ctx, db, organizationID, workspaceID, false)
}
func storedKeys(ctx context.Context, db interface{ NewSelect() *bun.SelectQuery }, organizationID, workspaceID string, overridesOnly bool) ([]string, error) {
	var rows []profileRow
	q := db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID)
	if workspaceID != "" {
		q = q.Where("workspace_id = ?", workspaceID)
	}
	if overridesOnly {
		q = q.Where("workspace_id IS NOT NULL")
	}
	if err := q.Scan(ctx); err != nil {
		return nil, err
	}
	keys := []string{}
	for _, row := range rows {
		var p Profile
		if err := json.Unmarshal([]byte(row.ProfileJSON), &p); err != nil {
			return nil, err
		}
		for _, img := range images(p) {
			if img != nil && hasImage(p, img.ID) {
				keys = append(keys, objectKey(organizationID, img.ID))
			}
		}
	}
	return keys, nil
}
