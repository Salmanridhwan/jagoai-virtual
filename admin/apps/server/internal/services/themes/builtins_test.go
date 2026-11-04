package themes

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuiltInResultsRemainIndependentAcrossCallers(t *testing.T) {
	expected := BuiltIns()
	for id, family := range expected {
		expectedFamily, err := json.Marshal(family)
		require.NoError(t, err)
		expectedSchemes := make(map[ColorScheme][]byte, len(family.SupportedSchemes))
		for _, scheme := range family.SupportedSchemes {
			expectedSchemes[scheme], err = json.Marshal(family.Schemes.For(scheme))
			require.NoError(t, err)
		}
		t.Run(id, func(t *testing.T) {
			t.Parallel()
			catalog := BuiltIns()
			copy := catalog[id]
			copy.SupportedSchemes[0] = "changed"
			for _, scheme := range family.SupportedSchemes {
				manifest := copy.Schemes.For(scheme)
				manifest.Colors.Brand = "#000000"
				manifest.Typography.Body.Fallbacks[0] = "changed"

				resolver := newResolver(resolverStoreStub{
					selection: Selection{Reference: builtInReference(family)},
				})
				input := ResolveInput{WorkspaceID: "workspace-1", Scheme: scheme}
				first, err := resolver.Resolve(t.Context(), input)
				require.NoError(t, err)
				requireThemeJSON(t, expectedSchemes[scheme], first.Manifest)
				first.Manifest.Typography.Body.Fallbacks[0] = "changed"
				first.Manifest.Colors.Brand = "#000000"
				second, err := resolver.Resolve(t.Context(), input)
				require.NoError(t, err)
				requireThemeJSON(t, expectedSchemes[scheme], second.Manifest)
			}
			delete(catalog, id)
			requireThemeJSON(t, expectedFamily, BuiltIns()[id])
		})
	}
}

func TestWorkshopResultsRemainIndependentFromFallbacks(t *testing.T) {
	for _, scheme := range []ColorScheme{SchemeLight, SchemeDark} {
		expected, err := json.Marshal(Workshop(scheme))
		require.NoError(t, err)
		copy := Workshop(scheme)
		copy.Typography.Code.Fallbacks[0] = "changed"
		copy.Colors.Brand = "#000000"
		resolver := newResolver(resolverStoreStub{
			selection: Selection{Reference: ThemeReference{Kind: ReferenceBuiltIn, ID: "unknown", Version: 1}},
		})
		result, err := resolver.Resolve(t.Context(), ResolveInput{WorkspaceID: "workspace-1", Scheme: scheme})
		require.NoError(t, err)
		requireThemeJSON(t, expected, result.Manifest)
		result.Manifest.Typography.Code.Fallbacks[0] = "changed"
		requireThemeJSON(t, expected, Workshop(scheme))
	}
}

func requireThemeJSON(t *testing.T, expected []byte, actual any) {
	t.Helper()
	encoded, err := json.Marshal(actual)
	require.NoError(t, err)
	require.Equal(t, string(expected), string(encoded))
}
