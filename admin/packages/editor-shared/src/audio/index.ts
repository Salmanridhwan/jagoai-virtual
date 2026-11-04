/**
 * Shared audio analysis group: silence detection, speech detection, blob
 * analysis client (plus its worker), decoding helpers, and the AC-3 codec
 * probe used before decoding.
 *
 * The analysis worker entry (`analysis.worker.ts`) moves with its client so
 * the client's relative `new Worker(new URL(...))` construction is
 * unchanged. Worker entries are deliberately excluded from this index: they
 * must only load inside a worker, never in the main thread.
 */

export * from './audio-silence';
export * from './analysis-types';
export * from './analysis-client';
export * from './speech-detection';
export * from './analysis-decoder';
