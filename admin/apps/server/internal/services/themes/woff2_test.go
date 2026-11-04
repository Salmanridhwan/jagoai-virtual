package themes

import (
	"encoding/binary"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDecodeWOFF2RejectsDeclaredSFNTSizeThatDoesNotMatchDirectory(t *testing.T) {
	content := append([]byte(nil), realWOFF2(t)...)
	declared := binary.BigEndian.Uint32(content[16:20])
	binary.BigEndian.PutUint32(content[16:20], declared+4)

	_, err := decodeWOFF2Tables(content)
	require.Error(t, err)
	require.ErrorContains(t, err, "declared SFNT size")
}

func TestValidateFontAcceptsTransformedWOFF2Metrics(t *testing.T) {
	// Derived from the existing Roboto fixture with FontTools 4.61.1, enabling
	// glyf, loca and hmtx WOFF2 transforms. This exercises omitted side bearings.
	content, err := os.ReadFile("testdata/roboto-latin-400-hmtx-transform.woff2")
	require.NoError(t, err)
	require.NoError(t, ValidateFontContent(content, "woff2"))
	require.NoError(t, validateWOFF2(content, "Roboto", 400, "normal"))
	derivative, err := prepareNativeFontDerivative(content, "Roboto", 400, "normal")
	require.NoError(t, err)
	require.Equal(t, "ttf", derivative.Format)
	require.NoError(t, ValidateFontContent(derivative.Content, "ttf"))
}
