/**
 * Shared workspace-filesystem group: OPFS primitives, the active workspace
 * root owner, FileSystemHandle persistence, workspace path helpers, the
 * storage logger, and per-key async locks.
 *
 * Storage identity is unchanged: OPFS paths, IndexedDB database/table names,
 * and localStorage keys move verbatim with this code.
 */

export * from './logger';
export * from './paths';
export * from './with-key-lock';
export * from './root';
export * from './handles-db';
export * from './fs-primitives';
