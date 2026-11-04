package accountavatar

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

type stubResolver struct{}

func (stubResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
}

func TestCacheAvatarStoresAnImageBehindAnOpenPostURL(t *testing.T) {
	t.Parallel()

	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	service := New(storage)
	service.resolver = stubResolver{}
	service.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "scontent.cdninstagram.com", req.URL.Hostname())
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/jpeg"}},
			Body:       io.NopCloser(strings.NewReader(string(jpegFixture))),
			Request:    req,
		}, nil
	})}

	avatarURL, err := service.CacheAvatar(
		t.Context(),
		"account-1",
		"https://scontent.cdninstagram.com/profile.jpg?signature=provider",
	)
	require.NoError(t, err)
	require.Regexp(t, `^/avatars/avatar_account_account-1_[a-f0-9-]+\.jpg$`, avatarURL)

	key := strings.TrimPrefix(avatarURL, "/avatars/")
	stored, err := storage.Open(t.Context(), key)
	require.NoError(t, err)
	defer stored.Close()
	content, err := io.ReadAll(stored)
	require.NoError(t, err)
	require.Equal(t, jpegFixture, content)
}

func TestCacheAvatarRejectsCredentialedURL(t *testing.T) {
	t.Parallel()

	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	service := New(storage)
	service.resolver = stubResolver{}
	_, err := service.CacheAvatar(t.Context(), "account-1", "https://user:secret@media.licdn.com/photo.jpg")
	require.ErrorContains(t, err, "credential")
}

func TestDeleteIgnoresForeignURLs(t *testing.T) {
	t.Parallel()

	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	service := New(storage)
	require.NoError(t, service.Delete(t.Context(), "https://cdn.example/photo.jpg"))
	const key = "avatar_account_existing.jpg"
	_, err := storage.Save(t.Context(), key, strings.NewReader("stored-photo"))
	require.NoError(t, err)
	require.NoError(t, service.Delete(t.Context(), "https://cdn.example/"+key))
	stored, err := storage.Open(t.Context(), key)
	require.NoError(t, err)
	require.NoError(t, stored.Close())
	require.NoError(t, service.Delete(t.Context(), "/avatars/"+key))
	_, err = storage.Open(t.Context(), key)
	require.Error(t, err)
	require.NoError(t, service.Delete(t.Context(), "/avatars/not-an-account-avatar.jpg"))
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

var jpegFixture = []byte{
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01, 0x01, 0x01,
	0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
}

var _ netguard.Resolver = stubResolver{}
