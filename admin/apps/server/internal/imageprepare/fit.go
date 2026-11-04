package imageprepare

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/HugoSmits86/nativewebp"
	"github.com/disintegration/imaging"
	"github.com/openpost/backend/internal/capabilities"

	// Register the bounded WebP decoder used after DecodeConfig admission.
	_ "golang.org/x/image/webp"
)

var ErrCannotFit = errors.New("image cannot be fitted within the destination limits")
var ErrAnimated = errors.New("animated images cannot be fitted without losing frames")

// fit creates a padded, downscaled derivative. It never crops or modifies the
// source. Decoding and canvas allocations are bounded before they occur.
func fit(ctx context.Context, input []byte, limits capabilities.MediaConstraint) ([]byte, string, error) {
	source, err := decodeFitImage(ctx, input)
	if err != nil {
		return nil, "", err
	}
	w, h := source.Bounds().Dx(), source.Bounds().Dy()
	width, height := fitCanvas(w, h, limits)
	if !fitDimensionsSafe(width, height) {
		return nil, "", ErrCannotFit
	}
	maxBytes := int64(32 * 1024 * 1024)
	for _, n := range []int64{limits.MaxSizeBytes, limits.MaxImageSizeBytes} {
		if n > 0 && n < maxBytes {
			maxBytes = n
		}
	}
	for attempt := range 7 {
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		factor := math.Pow(.8, float64(attempt))
		cw, ch := max(1, int(float64(width)*factor)), max(1, int(float64(height)*factor))
		if cw < limits.MinWidth || ch < limits.MinHeight {
			break
		}
		scale := math.Min(1, math.Min(float64(cw)/float64(w), float64(ch)/float64(h)))
		resized := imaging.Resize(source, max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale)), imaging.Lanczos)
		canvas := imaging.PasteCenter(imaging.New(cw, ch, color.NRGBA{}), resized)
		data, mime, err := encodeFittedCanvas(ctx, canvas, limits.AllowedMIMEs, maxBytes)
		if err != nil || data != nil {
			return data, mime, err
		}
	}
	return nil, "", ErrCannotFit
}

func decodeFitImage(ctx context.Context, input []byte) (image.Image, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(input))
	if err != nil || !slices.Contains([]string{"png", "jpeg", "webp"}, format) || !fitDimensionsSafe(config.Width, config.Height) {
		return nil, ErrCannotFit
	}
	if animated(input, format) {
		return nil, ErrAnimated
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	source, err := imaging.Decode(bytes.NewReader(input), imaging.AutoOrientation(true))
	if err != nil {
		return nil, ErrCannotFit
	}
	return source, nil
}

func encodeFittedCanvas(ctx context.Context, canvas image.Image, allowed []string, maxBytes int64) ([]byte, string, error) {
	for _, mime := range []string{"image/png", "image/webp", "image/jpeg"} {
		if len(allowed) > 0 && !slices.Contains(allowed, mime) {
			continue
		}
		for _, quality := range []int{94, 86, 78} {
			if err := ctx.Err(); err != nil {
				return nil, "", err
			}
			data, err := encodeFittedImage(canvas, mime, quality)
			if err != nil {
				return nil, "", err
			}
			if err := ctx.Err(); err != nil {
				return nil, "", err
			}
			if int64(len(data)) <= maxBytes {
				return data, mime, nil
			}
			if mime != "image/jpeg" {
				break
			}
		}
	}
	return nil, "", nil
}

func encodeFittedImage(canvas image.Image, mime string, quality int) ([]byte, error) {
	var output bytes.Buffer
	var err error
	switch mime {
	case "image/png":
		err = png.Encode(&output, canvas)
	case "image/webp":
		err = nativewebp.Encode(&output, canvas, &nativewebp.Options{CompressionLevel: nativewebp.DefaultCompression})
	case "image/jpeg":
		size := canvas.Bounds().Size()
		opaque := imaging.Overlay(imaging.New(size.X, size.Y, color.White), canvas, image.Point{}, 1)
		err = jpeg.Encode(&output, opaque, &jpeg.Options{Quality: quality})
	}
	return output.Bytes(), err
}

func fitDimensionsSafe(w, h int) bool {
	return w > 0 && h > 0 && int64(w)*int64(h) <= 32*1024*1024
}

func fitCanvas(w, h int, limits capabilities.MediaConstraint) (int, int) {
	best := nearestFitRatio(w, h, limits.AspectRatios)
	width := math.Max(float64(w), float64(h)*best)
	width = math.Max(width, math.Max(float64(limits.MinWidth), float64(limits.MinHeight)*best))
	height := width / best
	scale := 1.0
	if limits.MaxWidth > 0 {
		scale = math.Min(scale, float64(limits.MaxWidth)/width)
	}
	if limits.MaxHeight > 0 {
		scale = math.Min(scale, float64(limits.MaxHeight)/height)
	}
	if limits.MaxPixels > 0 {
		scale = math.Min(scale, math.Sqrt(float64(limits.MaxPixels)/(width*height)))
	}
	if limits.MaxShortSide > 0 {
		scale = math.Min(scale, float64(limits.MaxShortSide)/math.Min(width, height))
	}
	if math.IsInf(width, 0) || math.IsInf(height, 0) || width*height > float64(math.MaxInt32) {
		return 0, 0
	}
	cw, ch := max(1, int(math.Floor(width*scale))), max(1, int(math.Floor(height*scale)))
	// Rounding a short side up to one pixel must not exceed the area budget.
	if limits.MaxPixels > 0 && int64(cw) > limits.MaxPixels/int64(ch) {
		if cw >= ch {
			cw = max(1, int(limits.MaxPixels/int64(ch)))
		} else {
			ch = max(1, int(limits.MaxPixels/int64(cw)))
		}
	}
	return cw, ch
}

func animated(input []byte, format string) bool {
	if format == "png" {
		for pos := 8; pos+12 <= len(input); {
			length := uint64(binary.BigEndian.Uint32(input[pos:]))
			if length+12 > uint64(len(input)-pos) {
				return true
			}
			kind := string(input[pos+4 : pos+8])
			if kind == "acTL" {
				return true
			}
			if kind == "IEND" {
				break
			}
			pos += int(length) + 12
		}
	}
	if format == "webp" {
		for pos := 12; pos+8 <= len(input); {
			length := uint64(binary.LittleEndian.Uint32(input[pos+4:]))
			if length+8 > uint64(len(input)-pos) {
				return true
			}
			kind := string(input[pos : pos+4])
			if kind == "ANIM" || kind == "ANMF" || kind == "VP8X" && length > 0 && input[pos+8]&2 != 0 {
				return true
			}
			pos += int(length) + 8 + int(length%2)
		}
	}
	return false
}

func nearestFitRatio(w, h int, ratios []string) float64 {
	ratio := float64(w) / float64(h)
	best, distance := ratio, math.Inf(1)
	for _, raw := range ratios {
		a, b, ok := strings.Cut(raw, ":")
		if !ok {
			continue
		}
		x, e1 := strconv.ParseFloat(a, 64)
		y, e2 := strconv.ParseFloat(b, 64)
		r := x / y
		if e1 != nil || e2 != nil || r <= 0 || math.IsInf(r, 0) || math.IsNaN(r) {
			continue
		}
		if d := math.Abs(math.Log(r / ratio)); d < distance {
			best, distance = r, d
		}
	}
	return best
}
