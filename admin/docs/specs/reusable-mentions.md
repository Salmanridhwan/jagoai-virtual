# Reusable mentions

The shared composer must offer a Workspace mention library when an author types `@`, including before any search characters. Authors can insert an existing entry or add one, then keep writing in All. An entry has one short alias and explicit per-network text or supported native identities. Account-specific provider search remains available.

The behavioral reference is Shoutrrr at `83895b361508f295b3f70736d5319dc8a5a88a0a`, particularly `resources/js/components/compose/mention-picker.tsx`, `resources/js/lib/compose/mentions.ts`, and `app/Http/Controllers/WorkspaceMentionController.php`. Its source is Apache-2.0. OpenPost implements its own controls and projection; no source is copied.

## Acceptance

- A saved entry belongs to one Workspace and uses its existing read and edit permissions.
- Bare `@` opens saved entries and an Add mention action in All. Filtering matches aliases and configured network text. The same entry can be reused in later posts and after reload.
- The short editor keeps ordinary typing, exact blank lines, image paste, undo, direction detection, and keyboard navigation. Pointer editing stays visually quiet; keyboard entry retains visible focus.
- Each insertion snapshots its mappings into authored mention metadata. Renaming or deleting the library entry changes future insertions only.
- Each destination resolves only its explicitly configured mapping. Networks without a mapping retain the alias as ordinary text. Never infer an identity from another network's handle.
- Native identities retain current provider and authority validation, permissions, and preflight. Plain text substitutions do not claim native tagging support.
- Shared source text and identities remain authored state. Destination text is a deterministic projection, not a new independent override. Later destination selection, joined thread output, shared edits, saved reads, readiness, text cards, and delivery use the same mapping rules.
- Explicit independent destination edits keep their own existing authorship. Clearing or editing a selected token preserves the current identity-removal contract.
- Existing drafts and all v1 native mention metadata keep their behavior. No editor document JSON or HTML enters persistence.

## Verification

Exercise real Workspace persistence and authorization, snapshot stability after library edits, Unicode byte ranges, different per-network labels, an unmapped network, independent overrides, joined sources, and final provider projections. Browser checks cover creation and reuse from All, keyboard selection, undo, reload, and both themes at desktop, 390px, and 320px. Keep native source checks distinct from device proof.
