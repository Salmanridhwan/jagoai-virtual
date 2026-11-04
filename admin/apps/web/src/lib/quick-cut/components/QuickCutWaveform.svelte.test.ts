import { beforeEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import type { WaveformData } from '@openpost/editor-shared/media';
import type { QuickCutSource } from '../types';
import { getQuickCutWaveform } from '../waveform';
import QuickCutWaveform from './QuickCutWaveform.svelte';

// Hold decoding at its asynchronous boundary; the component owns source replacement.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('../waveform', async (original) => ({
	...(await original<typeof import('../waveform')>()),
	getQuickCutWaveform: vi.fn()
}));

beforeEach(() => {
	vi.mocked(getQuickCutWaveform).mockReset();
});

test('does not draw a previous source after switching to a source without audio', async () => {
	const pending = Promise.withResolvers<WaveformData>();
	vi.mocked(getQuickCutWaveform).mockImplementation(() => pending.promise);
	const source: QuickCutSource = {
		id: 'recording',
		name: 'recording.wav',
		size: 100,
		mimeType: 'audio/wav',
		duration: 1,
		width: 0,
		height: 0,
		videoCodec: null,
		audioCodec: 'pcm-s16',
		sampleRate: 48_000,
		channels: 1,
		rotation: 0,
		fps: 0,
		keyframeTimestamps: [],
		keyframeState: 'audio-only',
		videoStreams: [],
		audioStreams: [{ index: 0, codec: 'pcm-s16', sampleRate: 48_000, channels: 1 }],
		file: new File(['audio'], 'recording.wav')
	};
	const props = { source, viewStartSeconds: 0, viewEndSeconds: 1 };
	const screen = await render(QuickCutWaveform, props);
	await expect.poll(() => vi.mocked(getQuickCutWaveform).mock.calls.length).toBe(1);
	await screen.rerender({ ...props, source: { ...source, id: 'silent', audioStreams: [] } });
	pending.resolve({
		peaks: new Float32Array([0.8]),
		durationSeconds: 1,
		samplesPerSecond: 1,
		loadedSamples: 1,
		isComplete: true
	});
	await pending.promise;
	await tick();
	expect(screen.container.querySelector('canvas')).toBeNull();
});
