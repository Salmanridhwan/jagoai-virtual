/**
 * Shared editor primitives used by both Quick Cut and the Video Editor.
 *
 * Browser-only: several modules touch OPFS, IndexedDB, workers, or media
 * decoders, so this package must stay out of any Node-side build. The
 * portable document types, mutation batches, and outbox stay in
 * `@openpost/video-project`, which remains dependency-free and portable.
 *
 * Groups (each also importable through its own subpath entry point):
 *
 * - `./audio` — silence/speech detection, the blob analysis client and its
 *   worker, decoding helpers, and the AC-3 probe.
 * - `./media` — media metadata types, waveform payload/protocol types, the
 *   size-bounded peak cache, and the AC-3 probe.
 * - `./transcript` — transcription engine types and the analysis resampler.
 *   The transcriber client stays in the web app (app message catalogue).
 * - `./settings` — keyboard-shortcut bindings, matching, and persistence.
 * - `./workspace` — OPFS primitives, workspace root, handle persistence,
 *   path helpers, logger, and key locks. Storage keys move verbatim.
 * - `./project-bundle` — bundle manifest types, hashing, and validation.
 *
 * Deliberately not here: the cloud project repository (app API/query
 * clients), source-transcript storage (authorization boundary), the
 * transcriber/bridge (app worker pool and messages), speech-cleanup
 * settings (editor timeline types), and DOM components.
 */

export * from './audio/index';
export * from './media/index';
export * from './transcript/index';
export * from './settings/index';
export * from './workspace-fs/index';
export * from './project-bundle/index';
