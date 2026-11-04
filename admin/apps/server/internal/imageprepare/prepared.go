package imageprepare

import (
	"bytes"
	"crypto/sha256"
	"image"
	"slices"

	"github.com/disintegration/imaging"
	"github.com/openpost/backend/internal/imagethumbnail"
)

const ThumbnailSizeSM = 150
const ThumbnailSizeMD = 400

type Thumbnail struct {
	Size string
	MIME string
	Data []byte
}

// Prepared is produced only by the bounded worker. Its private receipt binds
// admitted pixels and thumbnails to the exact bytes saved by the upload owner.
type Prepared struct {
	Content    []byte
	MIME       string
	Width      int
	Height     int
	Thumbnails []Thumbnail
	receipt    [32]byte
}

func (p *Prepared) Matches(content []byte, mime string) bool {
	return p != nil && p.MIME == mime && p.receipt == sha256.Sum256(content) && fitDimensionsSafe(p.Width, p.Height)
}

func completePreparation(content []byte, mime string) (*Prepared, error) {
	decoded, format, err := image.Decode(bytes.NewReader(content))
	if err != nil || !slices.Contains([]string{"png", "jpeg", "webp"}, format) {
		return nil, ErrCannotFit
	}
	width, height := decoded.Bounds().Dx(), decoded.Bounds().Dy()
	if !fitDimensionsSafe(width, height) {
		return nil, ErrCannotFit
	}
	result := &Prepared{Content: content, MIME: mime, Width: width, Height: height}
	thumbnailFormat, thumbnailMIME := imaging.JPEG, "image/jpeg"
	if opaque, ok := decoded.(interface{ Opaque() bool }); ok && !opaque.Opaque() {
		thumbnailFormat, thumbnailMIME = imaging.PNG, "image/png"
	}
	for _, variant := range []struct {
		name string
		size int
	}{{"sm", ThumbnailSizeSM}, {"md", ThumbnailSizeMD}} {
		thumbnail := imagethumbnail.Square(decoded, variant.size)
		var encoded bytes.Buffer
		if err := imaging.Encode(&encoded, thumbnail, thumbnailFormat); err != nil {
			return nil, err
		}
		result.Thumbnails = append(result.Thumbnails, Thumbnail{Size: variant.name, MIME: thumbnailMIME, Data: encoded.Bytes()})
	}
	return result, nil
}
