// Shared account monogram rule (issue #400).
//
// DOM-free and framework-free on purpose: the web account avatar and the
// native avatar adapter both import this module, and the preview package and
// the Go text-card renderer mirror the rule in their own owners. Keep it
// dependency-free so React Native can consume it without DOM or Svelte.
//
// Rule: first and last word initials for multi-word names, otherwise the
// first two characters of the single word, uppercased. A blank display name
// falls back to the handle; a blank handle falls back to "?".

function initialsOf(value: string): string | null {
  const normalized = value.trim().replace(/^@+/, "");
  if (!normalized) return null;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return `${words[0][0]}${words.at(-1)?.[0] ?? ""}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase();
}

export function monogramFor(displayName: string, handle?: string | null): string {
  return initialsOf(displayName) ?? initialsOf(handle ?? "") ?? "?";
}
