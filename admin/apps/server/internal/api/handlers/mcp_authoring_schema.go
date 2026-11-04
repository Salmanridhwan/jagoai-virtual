package handlers

import (
	"encoding/json"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// These finite authoring contracts use the REST owner, including nested mention
// annotations. MCP clients receive inline schemas rather than unresolved refs.
func mcpAuthoringSchema[T any]() map[string]any {
	registry := huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer)
	schema := registry.Schema(reflect.TypeFor[T](), false, "")
	encoded, err := json.Marshal(schema)
	if err != nil {
		panic(err)
	}
	var output map[string]any
	if err := json.Unmarshal(encoded, &output); err != nil {
		panic(err)
	}
	inlineMCPAuthoringSchema(output, registry, 0)
	return output
}
func inlineMCPAuthoringSchema(value any, registry huma.Registry, depth int) {
	if depth > 32 {
		panic("recursive authoring schema")
	}
	switch value := value.(type) {
	case map[string]any:
		if ref, ok := value["$ref"].(string); ok {
			schema := registry.SchemaFromRef(ref)
			if schema == nil {
				panic("missing authoring schema reference")
			}
			encoded, err := json.Marshal(schema)
			if err != nil {
				panic(err)
			}
			var resolved map[string]any
			if err := json.Unmarshal(encoded, &resolved); err != nil {
				panic(err)
			}
			delete(value, "$ref")
			for key, field := range resolved {
				value[key] = field
			}
		}
		if types, ok := value["type"].([]any); ok {
			nonNull := map[string]any{}
			for key, field := range value {
				nonNull[key] = field
				delete(value, key)
			}
			for _, kind := range types {
				if kind != "null" {
					nonNull["type"] = kind
					break
				}
			}
			value["anyOf"] = []any{nonNull, map[string]any{"enum": []any{nil}}}
		}
		for _, field := range value {
			inlineMCPAuthoringSchema(field, registry, depth+1)
		}
	case []any:
		for _, field := range value {
			inlineMCPAuthoringSchema(field, registry, depth+1)
		}
	}
}
