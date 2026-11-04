package imagegeneration

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"slices"

	"github.com/disintegration/imaging"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/models"
)

func validate(r ImageGenerationRequest) error {
	if err := validateRequestContext(r); err != nil {
		return err
	}
	if err := validateImageOptions(r); err != nil {
		return err
	}
	if r.Operation == "generate" {
		if r.SourceMediaID != "" || r.MaskPNG != "" || r.TargetLayerID != "" {
			return ErrInvalid
		}
		return nil
	}
	if r.SourceMediaID == "" || len(r.SourceMediaID) > 200 || len(r.TargetFingerprint) != 64 || r.Size != "auto" {
		return ErrInvalid
	}
	if r.Operation == "edit" {
		if r.TargetLayerID == "" || len(r.TargetLayerID) > 200 || r.MaskPNG != "" {
			return ErrInvalid
		}
		return nil
	}
	_, err := decodeMask(r.MaskPNG)
	return err
}

func validateRequestContext(r ImageGenerationRequest) error {
	if len(r.WorkspaceID) == 0 || len(r.WorkspaceID) > 200 || len(r.ProjectID) == 0 || len(r.ProjectID) > 200 || len(r.PageID) == 0 || len(r.PageID) > 200 || len(r.Prompt) == 0 || len(r.Prompt) > 8000 {
		return ErrInvalid
	}
	return nil
}

func validateImageOptions(r ImageGenerationRequest) error {
	if !slices.Contains([]string{"generate", "edit", "fill"}, r.Operation) || ai.ImageEndpoint(r.Model, r.Operation != "generate") == "" {
		return ErrInvalid
	}
	if !slices.Contains([]string{"auto", "low", "medium", "high", "xhigh", "max"}, r.Quality) || !slices.Contains([]string{"auto", "opaque", "transparent"}, r.Background) || !slices.Contains([]string{"auto", "square_hd", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"}, r.Size) {
		return ErrInvalid
	}
	return nil
}

func decodeBoundedImage(data []byte) (image.Image, error) {
	if len(data) == 0 || len(data) > 32*1024*1024 {
		return nil, ErrInvalid
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || !slices.Contains([]string{"png", "jpeg", "webp"}, format) || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 16_000_000 {
		return nil, ErrInvalid
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrInvalid
	}
	return decoded, nil
}

func decodeMask(encoded string) (image.Image, error) {
	if len(encoded) == 0 || len(encoded) > 5592408 {
		return nil, ErrInvalid
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || !bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) {
		return nil, ErrInvalid
	}
	mask, err := decodeBoundedImage(data)
	if err != nil {
		return nil, err
	}
	selected := false
	for y := mask.Bounds().Min.Y; y < mask.Bounds().Max.Y && !selected; y++ {
		for x := mask.Bounds().Min.X; x < mask.Bounds().Max.X; x++ {
			_, _, _, alpha := mask.At(x, y).RGBA()
			if alpha < 65535 {
				selected = true
				break
			}
		}
	}
	if !selected {
		return nil, ErrInvalid
	}
	return mask, nil
}

func pngBytes(img image.Image) ([]byte, error) {
	var output bytes.Buffer
	err := png.Encode(&output, img)
	return output.Bytes(), err
}

func (s *Service) providerInput(ctx context.Context, request ImageGenerationRequest) (ai.ImageRequest, error) {
	input := ai.ImageRequest{Endpoint: ai.ImageEndpoint(request.Model, request.Operation != "generate"), Prompt: request.Prompt, Quality: request.Quality, Size: request.Size, Background: request.Background}
	if request.Operation == "generate" {
		return input, nil
	}
	if err := s.checkSource(ctx, s.db, request); err != nil {
		return input, err
	}
	var media models.MediaAttachment
	if err := s.db.NewSelect().Model(&media).Where("id = ? AND workspace_id = ?", request.SourceMediaID, request.WorkspaceID).Scan(ctx); err != nil {
		return input, err
	}
	reader, err := s.storage.Open(ctx, media.FilePath)
	if err != nil {
		return input, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, 32*1024*1024+1))
	if err != nil {
		return input, err
	}
	source, err := decodeBoundedImage(data)
	if err != nil {
		return input, err
	}
	input.Source, err = pngBytes(source)
	if err != nil {
		return input, err
	}
	if request.Operation == "fill" {
		mask, err := decodeMask(request.MaskPNG)
		if err != nil || mask.Bounds().Size() != source.Bounds().Size() {
			return input, ErrInvalid
		}
		input.Mask, err = base64.StdEncoding.DecodeString(request.MaskPNG)
		if err != nil {
			return input, ErrInvalid
		}
	}
	return input, nil
}

// The provider mask guides inference. Clipping the output separately is what
// guarantees that a fill never changes pixels outside the author's selection.
func outputPNG(data []byte, request ImageGenerationRequest) ([]byte, error) {
	output, err := decodeBoundedImage(data)
	if err != nil {
		return nil, err
	}
	if request.Operation != "fill" {
		return pngBytes(output)
	}
	mask, err := decodeMask(request.MaskPNG)
	if err != nil {
		return nil, err
	}
	size := mask.Bounds().Size()
	result := imaging.Resize(output, size.X, size.Y, imaging.Lanczos)
	for y := 0; y < size.Y; y++ {
		for x := 0; x < size.X; x++ {
			_, _, _, protected := mask.At(x, y).RGBA()
			offset := result.PixOffset(x, y)
			result.Pix[offset+3] = uint8(uint32(result.Pix[offset+3]) * (65535 - protected) / 65535)
		}
	}
	return pngBytes(result)
}

func recipeJSON(request ImageGenerationRequest, receipt string) string {
	// Keep recipe provenance without embedding an entire mask in the Media UI.
	request.MaskPNG = ""
	encoded, _ := json.Marshal(struct {
		ImageGenerationRequest ImageGenerationRequest `json:"request"`
		ProviderRequestID      string                 `json:"provider_request_id"`
	}{request, receipt})
	return string(encoded)
}
