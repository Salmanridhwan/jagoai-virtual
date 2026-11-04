package imageprepare

import (
	"bytes"
	"context"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/stretchr/testify/require"
)

func fitTestImage(t *testing.T) []byte {
	t.Helper()
	source := image.NewNRGBA(image.Rect(0, 0, 240, 80))
	for y := range 80 {
		for x := range 240 {
			source.Set(x, y, color.NRGBA{R: 220, A: 255})
		}
	}
	var data bytes.Buffer
	require.NoError(t, png.Encode(&data, source))
	return data.Bytes()
}

func TestFitPadsWithoutCroppingAndRetainsSource(t *testing.T) {
	source := fitTestImage(t)
	before := bytes.Clone(source)
	for _, mime := range []string{"image/png", "image/webp", "image/jpeg"} {
		t.Run(mime, func(t *testing.T) {
			prepared, err := Prepare(t.Context(), source, capabilities.MediaConstraint{AllowedMIMEs: []string{mime}, AspectRatios: []string{"1:1"}, MaxWidth: 120, MaxHeight: 120, MaxImageSizeBytes: 50000})
			require.NoError(t, err)
			data, actual := prepared.Content, prepared.MIME
			require.Equal(t, mime, actual)
			require.LessOrEqual(t, len(data), 50000)
			decoded, _, err := image.Decode(bytes.NewReader(data))
			require.NoError(t, err)
			require.Equal(t, image.Rect(0, 0, 120, 120), decoded.Bounds())
			r, _, _, a := decoded.At(60, 60).RGBA()
			require.Greater(t, r, uint32(40000))
			require.Equal(t, uint32(65535), a)
			r, g, b, a := decoded.At(1, 1).RGBA()
			if mime == "image/jpeg" {
				require.Greater(t, min(r, g, b), uint32(60000))
			} else {
				require.Zero(t, a)
			}
		})
	}
	require.Equal(t, before, source)
}

func TestFitRejectsAnimationUnsafeDimensionsAndImpossibleLimits(t *testing.T) {
	source := fitTestImage(t)
	chunk := make([]byte, 20)
	binary.BigEndian.PutUint32(chunk, 8)
	copy(chunk[4:], "acTL")
	binary.BigEndian.PutUint32(chunk[8:], 2)
	binary.BigEndian.PutUint32(chunk[16:], crc32.ChecksumIEEE(chunk[4:16]))
	animatedPNG := append(bytes.Clone(source[:33]), chunk...)
	animatedPNG = append(animatedPNG, source[33:]...)
	_, err := Prepare(t.Context(), animatedPNG, capabilities.MediaConstraint{})
	require.ErrorIs(t, err, ErrAnimated)
	huge := bytes.Clone(source)
	binary.BigEndian.PutUint32(huge[16:], 100000)
	binary.BigEndian.PutUint32(huge[20:], 100000)
	binary.BigEndian.PutUint32(huge[29:], crc32.ChecksumIEEE(huge[12:29]))
	_, err = Prepare(t.Context(), huge, capabilities.MediaConstraint{})
	require.ErrorIs(t, err, ErrCannotFit)
	for _, limits := range []capabilities.MediaConstraint{
		{AllowedMIMEs: []string{"video/mp4"}}, {MinWidth: 200, MaxWidth: 100}, {MaxImageSizeBytes: 1},
	} {
		_, err = Prepare(t.Context(), source, limits)
		require.ErrorIs(t, err, ErrCannotFit)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = Prepare(ctx, source, capabilities.MediaConstraint{})
	require.ErrorIs(t, err, context.Canceled)
}

func TestFitNarrowImageRespectsPixelBudget(t *testing.T) {
	var input bytes.Buffer
	require.NoError(t, png.Encode(&input, image.NewNRGBA(image.Rect(0, 0, 10000, 1))))
	prepared, err := Prepare(t.Context(), input.Bytes(), capabilities.MediaConstraint{MaxPixels: 1000})
	require.NoError(t, err)
	config, _, err := image.DecodeConfig(bytes.NewReader(prepared.Content))
	require.NoError(t, err)
	require.LessOrEqual(t, config.Width*config.Height, 1000)
}

func TestMain(m *testing.M) {
	if handled, err := RunWorker(os.Args[1:], os.Stdin, os.Stdout); handled {
		if err != nil {
			os.Exit(1)
		}
		return
	}
	os.Exit(m.Run())
}

func TestFitDeadlineTerminatesImageWorker(t *testing.T) {
	var input bytes.Buffer
	require.NoError(t, png.Encode(&input, image.NewNRGBA(image.Rect(0, 0, 4096, 4096))))
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := Prepare(ctx, input.Bytes(), capabilities.MediaConstraint{AspectRatios: []string{"1:1"}})
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Less(t, time.Since(started), time.Second)
}
