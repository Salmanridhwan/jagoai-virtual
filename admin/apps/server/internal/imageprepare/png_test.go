package imageprepare

import (
	"bytes"
	"context"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOptimizePreservesPixelsAndMetadata(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 128, 96))
	for y := range 96 {
		for x := range 128 {
			source.SetNRGBA(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 180, A: uint8(x + y)})
		}
	}
	var original bytes.Buffer
	require.NoError(t, (&png.Encoder{CompressionLevel: png.NoCompression}).Encode(&original, source))
	// A rendering metadata chunk must survive byte-for-byte, independently of pixels.
	metadata := pngChunk("gAMA", []byte{0, 0, 177, 143})
	input := append(append(append([]byte{}, original.Bytes()[:33]...), metadata...), original.Bytes()[33:]...)
	optimized, err := OptimizePNG(context.Background(), input)
	require.NoError(t, err)
	require.Less(t, len(optimized), len(input))
	require.Contains(t, string(optimized), string(metadata))
	before, err := png.Decode(bytes.NewReader(input))
	require.NoError(t, err)
	after, err := png.Decode(bytes.NewReader(optimized))
	require.NoError(t, err)
	require.Equal(t, before.Bounds(), after.Bounds())
	for y := range 96 {
		for x := range 128 {
			require.Equal(t, before.At(x, y), after.At(x, y))
		}
	}
	again, err := OptimizePNG(context.Background(), optimized)
	require.NoError(t, err)
	require.Equal(t, optimized, again)
	require.Equal(t, original.Bytes()[:33], input[:33])
}
func TestOptimizeLeavesOtherFormatsAndRejectsInvalidData(t *testing.T) {
	data := []byte("GIF89a original animated image")
	got, err := OptimizePNG(context.Background(), data)
	require.NoError(t, err)
	require.Equal(t, data, got)
	_, err = OptimizePNG(context.Background(), append(signature, 1, 2))
	require.Error(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var source bytes.Buffer
	require.NoError(t, png.Encode(&source, image.NewNRGBA(image.Rect(0, 0, 4, 4))))
	_, err = OptimizePNG(ctx, source.Bytes())
	require.ErrorIs(t, err, context.Canceled)
}
func pngChunk(kind string, data []byte) []byte {
	var out bytes.Buffer
	_ = binary.Write(&out, binary.BigEndian, uint32(len(data)))
	out.WriteString(kind)
	out.Write(data)
	_ = binary.Write(&out, binary.BigEndian, crc32.ChecksumIEEE(out.Bytes()[4:]))
	return out.Bytes()
}
