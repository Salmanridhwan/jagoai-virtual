package textcards

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
	textrender "github.com/go-text/render"
	"github.com/openpost/backend/internal/imagethumbnail"
)

type Identity struct {
	Name   string `json:"name"`
	Handle string `json:"handle"`
}

type Image struct {
	JPEG          []byte
	Width, Height int
}

func Render(ctx context.Context, body, outputProfile string, style Style, identity Identity, avatar image.Image, attachments int) ([]Image, error) {
	pages, err := Layout(body, outputProfile)
	if err != nil {
		return nil, err
	}
	faces, err := newFaces()
	if err != nil {
		return nil, err
	}
	var result []Image
	for index, page := range pages {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		canvas := image.NewNRGBA(image.Rect(0, 0, Width, page.Height))
		paintBackground(canvas, style)
		contentHeight := len(page.lines) * lineHeight(page.size)
		// The 276px footer reserve keeps the last text baseline clear of the
		// footer arrow and page counter. 244px left the arrow's head inside the
		// descender band of a full page of text.
		cardHeight := max(380, contentHeight+276)
		top := (page.Height - cardHeight) / 2
		card := image.Rect(80, top, 1000, top+cardHeight)
		radius := 0
		if style.Rounded {
			radius = 32
		}
		ink, muted, paper := parseColor("#18181b"), parseColor("#6b7280"), parseColor("#ffffff")
		if style.Appearance == "dark" {
			ink, muted, paper = parseColor("#f4f4f5"), parseColor("#a1a1aa"), parseColor("#18181b")
		}
		if style.Shadow {
			shadow := image.NewNRGBA(canvas.Bounds())
			paintRounded(shadow, card.Add(image.Pt(0, 18)), radius, color.NRGBA{A: 65})
			draw.Draw(canvas, canvas.Bounds(), imaging.Blur(shadow, 22), image.Point{}, draw.Over)
		}
		paintRounded(canvas, card, radius, paper)
		paintAvatar(canvas, avatar, identity.Name, faces, top, style)
		drawLabel(canvas, identity.Name, faces, 34, 238, top+86, 690, ink)
		handle := strings.TrimPrefix(identity.Handle, "@")
		if handle != "" {
			handle = "@" + handle
		}
		drawLabel(canvas, handle, faces, 27, 238, top+123, 690, muted)
		y := top + 188 + page.size
		for _, line := range page.lines {
			drawLine(canvas, line, 136, y, textWidth, ink)
			y += lineHeight(page.size)
		}
		more := index+1 < len(pages) || attachments > 0
		if more {
			footerY := card.Max.Y - 43
			paintArrow(canvas, 896, footerY-8, muted)
			if len(pages) > 1 {
				drawLabel(canvas, fmt.Sprintf("%d / %d", index+1, len(pages)+attachments), faces, 23, 136, footerY, 200, muted)
			}
		}
		var buffer bytes.Buffer
		if err := jpeg.Encode(&buffer, canvas, &jpeg.Options{Quality: 94}); err != nil {
			return nil, err
		}
		result = append(result, Image{JPEG: buffer.Bytes(), Width: Width, Height: page.Height})
	}
	return result, nil
}

func drawLabel(canvas *image.NRGBA, value string, faces fontMap, size, x, y, width int, ink color.NRGBA) {
	lines := wrapText(ellipsizeLabel(value, faces, size, width), faces, size, width)
	if len(lines) > 0 {
		drawLine(canvas, lines[0], x, y, width, ink)
	}
}

const ellipsis = "…"

// ellipsizeLabel collapses value to the longest single-line prefix that fits
// width, suffixed with an ellipsis when the full text was clipped. Values
// that already fit on one line are returned unchanged, so normal identities
// render byte-identical output to before.
func ellipsizeLabel(value string, faces fontMap, size, width int) string {
	lines := wrapText(value, faces, size, width)
	if len(lines) <= 1 && (len(lines) == 0 || lines[0].width <= width) {
		return value
	}
	runes := []rune(strings.ReplaceAll(value, "\n", " "))
	fits := func(n int) bool {
		candidate := strings.TrimRight(string(runes[:n]), " \t") + ellipsis
		candidateLines := wrapText(candidate, faces, size, width)
		return len(candidateLines) == 1 && candidateLines[0].width <= width
	}
	if !fits(0) {
		return ellipsis
	}
	low, high := 0, len(runes)
	for low < high {
		mid := (low + high + 1) / 2
		if fits(mid) {
			low = mid
		} else {
			high = mid - 1
		}
	}
	return strings.TrimRight(string(runes[:low]), " \t") + ellipsis
}

func drawLine(canvas *image.NRGBA, item line, x, y, width int, ink color.NRGBA) {
	if item.rtl {
		x += width - item.width
	}
	var renderer textrender.Renderer
	renderer.Color = ink
	for _, run := range item.runs {
		renderer.FontSize = float32(run.Size) / 64
		renderer.PixScale = 1
		x = renderer.DrawShapedRunAt(run, canvas, x, y)
	}
}

func parseColor(value string) color.NRGBA {
	rgb, _ := strconv.ParseUint(strings.TrimPrefix(value, "#"), 16, 32)
	return color.NRGBA{R: uint8(rgb >> 16), G: uint8(rgb >> 8), B: uint8(rgb), A: 255}
}

func paintBackground(canvas *image.NRGBA, style Style) {
	from, to := parseColor(style.Color), parseColor(style.ColorEnd)
	for y := 0; y < canvas.Bounds().Dy(); y++ {
		for x := 0; x < Width; x++ {
			u, v := float64(x)/Width, float64(y)/float64(canvas.Bounds().Dy())
			t := 0.0
			switch style.Background {
			case "gradient":
				t = (u + v) / 2
			case "mesh":
				t = min(1, max(0, 0.5+0.3*math.Sin(u*5+v*3)+0.2*math.Cos(v*6-u*2)))
			}
			canvas.SetNRGBA(x, y, color.NRGBA{R: uint8(float64(from.R)*(1-t) + float64(to.R)*t), G: uint8(float64(from.G)*(1-t) + float64(to.G)*t), B: uint8(float64(from.B)*(1-t) + float64(to.B)*t), A: 255})
		}
	}
}

func paintRounded(canvas *image.NRGBA, rect image.Rectangle, radius int, ink color.NRGBA) {
	for y := rect.Min.Y; y < rect.Max.Y; y++ {
		for x := rect.Min.X; x < rect.Max.X; x++ {
			dx := max(rect.Min.X+radius-x, x-(rect.Max.X-radius-1), 0)
			dy := max(rect.Min.Y+radius-y, y-(rect.Max.Y-radius-1), 0)
			if dx*dx+dy*dy <= radius*radius {
				canvas.SetNRGBA(x, y, ink)
			}
		}
	}
}

func paintArrow(canvas *image.NRGBA, x, y int, ink color.NRGBA) {
	for dx := 0; dx < 34; dx++ {
		for d := -2; d <= 2; d++ {
			canvas.SetNRGBA(x+dx, y+d, ink)
		}
	}
	for i := 0; i < 14; i++ {
		for d := -2; d <= 2; d++ {
			canvas.SetNRGBA(x+33-i, y-i+d, ink)
			canvas.SetNRGBA(x+33-i, y+i+d, ink)
		}
	}
}

func paintAvatar(canvas *image.NRGBA, avatar image.Image, name string, faces fontMap, top int, style Style) {
	avatarRect := image.Rect(136, top+54, 214, top+132)
	disc, initialInk := avatarPlaceholderColors(style)
	paintRounded(canvas, avatarRect, 39, disc)
	if avatar != nil {
		photo := imagethumbnail.Square(avatar, 78)
		mask := image.NewAlpha(image.Rect(0, 0, 78, 78))
		for y := 0; y < 78; y++ {
			for x := 0; x < 78; x++ {
				if math.Hypot(float64(x)-38.5, float64(y)-38.5) <= 39 {
					mask.SetAlpha(x, y, color.Alpha{A: 255})
				}
			}
		}
		draw.DrawMask(canvas, avatarRect, photo, image.Point{}, mask, image.Point{}, draw.Over)
	} else {
		letter := "O"
		if runes := []rune(strings.TrimSpace(name)); len(runes) > 0 {
			letter = strings.ToUpper(string(runes[0]))
		}
		drawLabel(canvas, letter, faces, 36, 154, top+108, 70, initialInk)
	}
}

// avatarPlaceholderColors owns the text-card avatar placeholder palette.
//
// The disc follows the card's authored text_card_color (falling back to
// DefaultColor when unset) so the monogram reads as part of the card rather
// than a fixed violet patch. The initial keeps the brand indigo #312e81 on
// light discs and switches to white on dark discs, whichever contrasts more
// with the disc. Both candidates contrast against the default gradient in
// either appearance; arbitrary author colors cannot guarantee a ratio, so the
// rule maximizes rather than floors it.
func avatarPlaceholderColors(style Style) (disc, initial color.NRGBA) {
	disc = parseColor(DefaultColor)
	if hexColor.MatchString(style.Color) {
		disc = parseColor(style.Color)
	}
	indigo := parseColor("#312e81")
	light := parseColor("#ffffff")
	initial = indigo
	if contrastRatio(disc, light) > contrastRatio(disc, indigo) {
		initial = light
	}
	return disc, initial
}

func linearChannel(v float64) float64 {
	if v <= 0.03928 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

func relativeLuminance(c color.NRGBA) float64 {
	return 0.2126*linearChannel(float64(c.R)/255) + 0.7152*linearChannel(float64(c.G)/255) + 0.0722*linearChannel(float64(c.B)/255)
}

func contrastRatio(a, b color.NRGBA) float64 {
	la, lb := relativeLuminance(a), relativeLuminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}
