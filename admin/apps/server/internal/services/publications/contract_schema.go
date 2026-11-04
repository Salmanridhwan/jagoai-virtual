package publications

import (
	"reflect"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/posttext"
)

// PublicationSegmentSettings retains provider-specific keys while declaring
// the shared authored mention contract for generated API consumers.
type PublicationSegmentSettings map[string]any

func (PublicationSegmentSettings) Schema(registry huma.Registry) *huma.Schema {
	return &huma.Schema{Type: huma.TypeObject, Properties: map[string]*huma.Schema{
		posttext.SettingsKey: registry.Schema(reflect.TypeFor[posttext.Mentions](), true, "Mentions"),
	}, AdditionalProperties: &huma.Schema{}}
}
