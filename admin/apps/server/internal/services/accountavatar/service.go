package accountavatar

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/avatarfetch"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/services/mediastore"
)

const (
	accountAvatarKeyPrefix = "avatar_account_"
	accountAvatarURLPrefix = "/avatars/"
	maxAccountAvatarBytes  = 4 * 1024 * 1024
	accountAvatarTimeout   = 15 * time.Second
)

var unsafeObjectKeyCharacter = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

type Service struct {
	storage  mediastore.BlobStorage
	client   *http.Client
	resolver netguard.Resolver
}

// Cache is the storage boundary used by account connection and profile refresh.
type Cache interface {
	CacheAvatar(context.Context, string, string) (string, error)
	Delete(context.Context, string) error
}

func New(storage mediastore.BlobStorage) *Service {
	return &Service{storage: storage}
}

// CacheAvatar copies any provider's profile photo into our storage so the
// stored photo keeps working after the provider's signed CDN URL expires.
// The previous photo, if any, stays the caller's to retire through Delete so
// replaced photos stop counting against storage.
func (s *Service) CacheAvatar(ctx context.Context, accountID, rawURL string) (string, error) {
	result, err := avatarfetch.Fetch(ctx, rawURL, avatarfetch.Bounds{
		Label: "profile photo URL", Timeout: accountAvatarTimeout,
		MaxBytes: maxAccountAvatarBytes, Resolver: s.resolver, Client: s.client,
	})
	if err != nil {
		return "", err
	}
	contentType := result.ContentType
	extension := imageExtension(contentType)
	if extension == "" {
		return "", fmt.Errorf("profile photo has unsupported content type %q", contentType)
	}

	key := fmt.Sprintf(
		accountAvatarKeyPrefix+"%s_%s%s",
		unsafeObjectKeyCharacter.ReplaceAllString(accountID, "_"),
		uuid.NewString(),
		extension,
	)
	if _, err := mediastore.SaveWithContentType(ctx, s.storage, key, bytes.NewReader(result.Data), contentType); err != nil {
		_ = mediastore.DeleteForCleanup(ctx, s.storage, key)
		return "", fmt.Errorf("save profile photo: %w", err)
	}
	return accountAvatarURLPrefix + key, nil
}

func (s *Service) Delete(ctx context.Context, avatarURL string) error {
	if !IsCached(avatarURL) {
		return nil
	}
	key := filepath.Base(avatarURL)
	return mediastore.DeleteForCleanup(ctx, s.storage, key)
}

// IsCached identifies only account photos served by OpenPost, never remote URLs.
func IsCached(rawURL string) bool {
	return strings.HasPrefix(rawURL, accountAvatarURLPrefix+accountAvatarKeyPrefix) &&
		!strings.ContainsAny(strings.TrimPrefix(rawURL, accountAvatarURLPrefix), "/?#")
}

func imageExtension(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}
