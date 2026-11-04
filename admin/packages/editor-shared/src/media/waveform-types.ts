/**
 * Waveform payload and worker protocol types shared by Quick Cut and the
 * Video Editor.
 *
 * `WaveformData` is the decoded peak payload produced by
 * `apps/web/src/lib/video-editor/media/waveform-client.ts`; the
 * `Waveform*Request`/`Waveform*Message` protocol is spoken by the worker
 * entry at `apps/web/src/lib/video-editor/media/waveform-worker.ts`. Both
 * declarations moved here verbatim so the two editors share one documented
 * type identity. The worker entry file itself stays in the web app so the
 * existing `new Worker(new URL(...))` construction sites keep resolving.
 */

export interface WaveformData {
	peaks: Float32Array;
	durationSeconds: number;
	samplesPerSecond: number;
	loadedSamples: number;
	isComplete: boolean;
}

export interface WaveformGenerateRequest {
	type: 'generate';
	requestId: string;
	file: File;
	samplesPerSecond: number;
	binDurationSeconds?: number;
	trackIndex?: number;
}

export interface WaveformAbortRequest {
	type: 'abort';
	requestId: string;
}

export type WaveformWorkerRequest = WaveformGenerateRequest | WaveformAbortRequest;

export interface WaveformInitMessage {
	type: 'init';
	requestId: string;
	durationSeconds: number;
	totalSamples: number;
}

export interface WaveformChunkMessage {
	type: 'chunk';
	requestId: string;
	startIndex: number;
	peaks: Float32Array;
}

export interface WaveformCompleteMessage {
	type: 'complete';
	requestId: string;
	maxPeak: number;
}

export interface WaveformProgressMessage {
	type: 'progress';
	requestId: string;
	progress: number;
}

export interface WaveformErrorMessage {
	type: 'error';
	requestId: string;
	message: string;
}

export type WaveformWorkerResponse =
	| WaveformInitMessage
	| WaveformChunkMessage
	| WaveformCompleteMessage
	| WaveformProgressMessage
	| WaveformErrorMessage;
