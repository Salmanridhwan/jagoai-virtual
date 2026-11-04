/**
 * Generic JSON value aliases for bundle checksum canonicalization.
 *
 * Mirrors the structural aliases in
 * `apps/web/src/lib/video-editor/project-bundle/snapshot-types.ts`, which
 * cannot move here because the rest of that module is coupled to the editor
 * project document. These aliases carry no runtime code.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
