package publicationbuilder

import "github.com/openpost/backend/internal/ai"

var optionMediaTreatments = []string{"none", "use_source", "meme", "template", "attach_image", "attach_video"}

func optionsDirectionSchema(input BuildInput, index []templateIndexEntry) *ai.JSONSchema {
	direction := directorResponseSchema(input.Destinations, input).Schema
	properties := direction["properties"].(map[string]any)
	media := mediaPlanSchema()
	mediaProperties := media["properties"].(map[string]any)
	mediaProperties["treatment"] = map[string]any{"type": "string", "enum": optionMediaTreatments}
	ids := make([]string, 0, 5+len(index))
	ids = append(ids, "", "messages", "group-chat", "receipt", "status-page")
	for _, template := range index {
		ids = append(ids, template.ID)
	}
	mediaProperties["template_id"] = map[string]any{"type": "string", "enum": ids}
	media["required"] = append(media["required"].([]string), "template_id")
	properties["media"] = media
	decisions := properties["destinations"].(map[string]any)["items"].(map[string]any)
	decisions["properties"].(map[string]any)["media"] = media
	decisions["required"] = append(decisions["required"].([]string), "media")
	option := schemaObject(map[string]any{"label": schemaString(1, 100), "direction": direction}, "label", "direction")
	return &ai.JSONSchema{Name: "openpost_four_post_directions", Schema: schemaObject(map[string]any{"options": schemaArray(option, 4, 4)}, "options")}
}

func optionsOutputSchema(input BuildInput) *ai.JSONSchema {
	variants := make([]map[string]any, 0, len(input.Destinations))
	for _, destination := range input.Destinations {
		policy, _ := policyFor(destination.Platform)
		schema := adapterResponseSchema(destination, policy, sourceReferenceCatalogFor(input)).Schema
		props := schema["properties"].(map[string]any)
		media := mediaPlanSchema()
		mediaProps := media["properties"].(map[string]any)
		mediaProps["treatment"] = map[string]any{"type": "string", "enum": optionMediaTreatments}
		mediaProps["template_id"] = schemaString(0, 80)
		mediaProps["document"] = map[string]any{"anyOf": []any{visualDocumentSchema(), map[string]any{"type": "null"}}}
		mediaProps["alt_text"] = schemaString(0, 500)
		media["required"] = append(media["required"].([]string), "template_id", "document", "alt_text")
		props["media"] = media
		segments := props["segments"].(map[string]any)
		body := segments["items"].(map[string]any)["properties"].(map[string]any)["body"].(map[string]any)
		body["minLength"] = 0
		variants = append(variants, schema)
	}
	plan := map[string]any{"anyOf": variants}
	if len(variants) == 1 {
		plan = variants[0]
	}
	option := schemaObject(map[string]any{
		"destinations": schemaArray(plan, 1, len(input.Destinations)),
		"skipped":      schemaArray(schemaObject(map[string]any{"account_id": schemaString(1, 160), "platform": schemaString(1, 80), "reason": schemaString(1, 800)}, "account_id", "platform", "reason"), 0, len(input.Destinations)),
	}, "destinations", "skipped")
	return &ai.JSONSchema{Name: "openpost_four_complete_posts", Schema: schemaObject(map[string]any{"options": schemaArray(option, 4, 4)}, "options")}
}

func enum(values ...string) map[string]any { return map[string]any{"type": "string", "enum": values} }
func integer(minimum, maximum int) map[string]any {
	return map[string]any{"type": "integer", "minimum": minimum, "maximum": maximum}
}
func nullable(schema map[string]any) map[string]any {
	return map[string]any{"anyOf": []any{schema, map[string]any{"type": "null"}}}
}

func visualDocumentSchema() map[string]any {
	person := schemaObject(map[string]any{"id": schemaString(1, 80), "name": schemaString(1, 100)}, "id", "name")
	message := schemaObject(map[string]any{"id": schemaString(1, 80), "sender_id": schemaString(1, 80), "text": schemaString(1, 2000)}, "id", "sender_id", "text")
	conversation := schemaObject(map[string]any{"name": schemaString(1, 100), "timestamp": schemaString(0, 100), "show_header": map[string]any{"type": "boolean"}, "read_receipt": schemaString(0, 100), "self_id": schemaString(1, 80), "people": schemaArray(person, 2, 12), "messages": schemaArray(message, 1, 12)}, "name", "timestamp", "show_header", "read_receipt", "self_id", "people", "messages")
	receiptItem := schemaObject(map[string]any{"id": schemaString(1, 80), "name": schemaString(1, 200), "quantity": integer(1, 999), "amount_cents": integer(0, 99999999)}, "id", "name", "quantity", "amount_cents")
	receipt := schemaObject(map[string]any{"business": schemaString(1, 150), "address": schemaString(0, 300), "timestamp": schemaString(0, 100), "order": schemaString(0, 100), "currency": enum("USD", "EUR", "GBP", "BRL", "JPY"), "tax_percent": map[string]any{"type": "number", "minimum": 0, "maximum": 100}, "custom_total": schemaString(0, 100), "footer": schemaString(0, 500), "items": schemaArray(receiptItem, 1, 12)}, "business", "address", "timestamp", "order", "currency", "tax_percent", "custom_total", "footer", "items")
	update := schemaObject(map[string]any{"id": schemaString(1, 80), "stage": schemaString(1, 80), "text": schemaString(1, 2000), "timestamp": schemaString(0, 100)}, "id", "stage", "text", "timestamp")
	status := schemaObject(map[string]any{"name": schemaString(1, 150), "headline": schemaString(1, 200), "severity": enum("operational", "degraded", "outage"), "updates": schemaArray(update, 1, 12)}, "name", "headline", "severity", "updates")
	meme := schemaObject(map[string]any{"template_id": schemaString(1, 80), "name": schemaString(1, 150), "captions": schemaArray(schemaString(0, 200), 1, 16), "overlay_slots": integer(0, 0), "overlay_media_ids": schemaArray(schemaString(1, 80), 0, 0), "format": enum("png"), "alt_text": schemaString(0, 500)}, "template_id", "name", "captions", "overlay_slots", "overlay_media_ids", "format", "alt_text")
	return schemaObject(map[string]any{"schema_version": integer(1, 1), "template_id": enum("meme", "messages", "group-chat", "receipt", "status-page"), "title": schemaString(1, 150), "appearance": enum("light", "dark"), "frame": enum("natural", "square", "portrait"), "text_size": enum("small", "normal", "large"), "meme": nullable(meme), "conversation": nullable(conversation), "receipt": nullable(receipt), "status_page": nullable(status)}, "schema_version", "template_id", "title", "appearance", "frame", "text_size", "meme", "conversation", "receipt", "status_page")
}
