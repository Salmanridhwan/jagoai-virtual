package imagethumbnail

import (
	"image"
	"image/color"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSquareKeepsThinImageAllocationsBounded(t *testing.T) {
	for _, bounds := range []image.Rectangle{image.Rect(0, 0, 1000, 1), image.Rect(0, 0, 1, 1000)} {
		t.Run(bounds.String(), func(t *testing.T) {
			source := image.NewNRGBA(bounds)
			blue := color.NRGBA{B: 255, A: 255}
			for y := 0; y < bounds.Dy(); y++ {
				for x := 0; x < bounds.Dx(); x++ {
					source.SetNRGBA(x, y, color.NRGBA{R: 255, A: 255})
				}
			}
			source.SetNRGBA((bounds.Dx()-1)/2, (bounds.Dy()-1)/2, blue)
			source.SetNRGBA(bounds.Dx()/2, bounds.Dy()/2, blue)
			runtime.GC()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			result := Square(source, 400)
			runtime.ReadMemStats(&after)
			require.Less(t, after.TotalAlloc-before.TotalAlloc, uint64(32*1024*1024), "a tiny source must not expand into a full-size strip before cropping")
			require.Equal(t, image.Rect(0, 0, 400, 400), result.Bounds())
			require.Equal(t, blue, result.NRGBAAt(200, 200))
		})
	}
}
