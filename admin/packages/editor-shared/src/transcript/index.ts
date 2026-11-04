/**
 * Shared transcript group: transcription engine message/model types and the
 * channel resampler used by audio analysis workers.
 *
 * The transcriber client, bridge, and models stay in the web app: they
 * depend on app message catalogues and worker pools that only one editor
 * composition owns.
 */

export * from './engine/types';
export * from './engine/lib/resampler';
