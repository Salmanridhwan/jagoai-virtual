package imagethumbnail

import (
	"image"

	"github.com/disintegration/imaging"
)

// Square creates a centered square preview without changing the source image.
func Square(source image.Image, size int) *image.NRGBA {
	if size <= 0 {
		return &image.NRGBA{}
	}
	side := min(source.Bounds().Dx(), source.Bounds().Dy())
	if side <= 0 {
		return &image.NRGBA{}
	}
	// Crop before enlarging, including sources with a one-pixel short side.
	// Resizing a full strip first can allocate hundreds of megabytes.
	return imaging.Resize(imaging.CropCenter(source, side, side), size, size, imaging.Lanczos)
}
