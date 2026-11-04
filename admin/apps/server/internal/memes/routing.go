package memes

// RoutingEntry keeps the complete catalogue cheap to inspect before loading
// selected visual assets and their exact caption contracts.
type RoutingEntry struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Meaning   string `json:"meaning"`
	Mechanism string `json:"mechanism"`
}

func RoutingIndex(catalog Catalog) []RoutingEntry {
	entries := make([]RoutingEntry, 0, len(catalog.Templates))
	for _, template := range catalog.Templates {
		entries = append(entries, RoutingEntry{ID: template.ID, Name: template.Name, Meaning: template.Semantic.Meaning, Mechanism: template.Semantic.Mechanism})
	}
	return entries
}
