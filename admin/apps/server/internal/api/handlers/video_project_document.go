package handlers

import (
	"bytes"
	"encoding/json"

	"github.com/danielgtaylor/huma/v2"
)

// Keep authored JSON opaque on reads. Decoding it into interface values only to
// encode it again allocates an object graph and can round stored numeric values.
type videoProjectDocument struct {
	json.RawMessage
}

func (videoProjectDocument) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{Type: huma.TypeObject, AdditionalProperties: &huma.Schema{}}
}

func (document videoProjectDocument) valid() bool {
	raw := bytes.TrimSpace(document.RawMessage)
	// Preserve the previous map decoder's acceptance of legacy null documents.
	return len(raw) > 0 && (raw[0] == '{' || bytes.Equal(raw, []byte("null"))) && json.Valid(document.RawMessage)
}
