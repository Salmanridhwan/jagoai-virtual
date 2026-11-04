package mediasigner

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestEmptySigningKeyCannotAuthorizeMedia(t *testing.T) {
	expires := time.Now().Add(time.Hour)
	mac := hmac.New(sha256.New, nil)
	_, _ = fmt.Fprintf(mac, "private-media:%d", expires.Unix())
	signer := New("")
	require.False(t, signer.Verify("private-media", hex.EncodeToString(mac.Sum(nil)), expires.Unix()))
	require.False(t, signer.Verify("private-media", "", expires.Unix()))
	require.Empty(t, signer.Sign("private-media", expires))
}
