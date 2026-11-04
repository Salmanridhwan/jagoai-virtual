package ai

import "context"

// ImageProvider separates paid dispatch from safe reads of a saved receipt.
type ImageProvider interface {
	SubmitImage(context.Context, ImageRequest) (string, error)
	ImageStatus(context.Context, string, string) (ImageStatus, error)
	ImageResult(context.Context, string, string) ([]byte, error)
	ImageCost(context.Context, string, string) (*int64, error)
}

type ImageRequest struct {
	Endpoint, Prompt, Quality, Size, Background string
	Source, Mask                                []byte
}

type ImageStatus struct {
	State  string
	Failed bool
}

type ImageModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

const DefaultImageModel = "gpt-image-2.5-flare"

func ImageModels() []ImageModel {
	return []ImageModel{{DefaultImageModel, "GPT Image 2.5 Flare"}, {"gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"}}
}

func ImageEndpoint(model string, edit bool) string {
	variant := "flare"
	if model == "gpt-image-2.5-sunburst" {
		variant = "sunburst"
	} else if model != DefaultImageModel {
		return ""
	}
	operation := "text-to-image"
	if edit {
		operation = "edit"
	}
	return "openai/gpt-image-2.5/" + variant + "/" + operation
}
