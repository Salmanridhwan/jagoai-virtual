import { beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { probeVideo } from '$lib/video/prepare';
import { firstPlatformVideoCodec } from '$lib/video/support';
import type { VideoMetadata } from '$lib/video/types';
import VideoEditorDialog from './video-editor-dialog.svelte';

// Keep the file/codec boundary pending to exercise replacement and cancellation races.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/video/prepare', () => ({ probeVideo: vi.fn() }));
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/video/support', () => ({ firstPlatformVideoCodec: vi.fn() }));

const metadata: VideoMetadata = {
	sizeBytes: 4,
	mimeType: 'video/mp4',
	durationSeconds: 10,
	width: 640,
	height: 360,
	videoCodec: 'avc',
	audioCodec: null,
	hasVideoTrack: true,
	canDecode: true
};
const probe = vi.mocked(probeVideo);
const codec = vi.mocked(firstPlatformVideoCodec);

beforeEach(() => {
	probe.mockReset().mockResolvedValue(metadata);
	codec.mockReset().mockResolvedValue('avc');
});

it.each(['unsupported', 'failed'] as const)(
	'keeps the current file crop controls after an older codec check is %s',
	async (outcome) => {
		const pending = Promise.withResolvers<'avc' | null>();
		probe
			.mockResolvedValueOnce(metadata)
			.mockResolvedValue({ ...metadata, width: 1280, height: 720 });
		codec.mockImplementationOnce(() => pending.promise);
		const props = {
			open: true,
			file: new File(['old'], 'old.mp4', { type: 'video/mp4' }),
			onConfirm: vi.fn(),
			onSkip: vi.fn()
		};
		const screen = await render(VideoEditorDialog, props);
		await expect.poll(() => codec.mock.calls.length).toBe(1);
		await screen.rerender({
			...props,
			file: new File(['new'], 'new.mp4', { type: 'video/mp4' })
		});
		const crop = screen.getByRole('button', { name: '1:1', exact: true });
		await expect.element(crop).toBeEnabled();
		if (outcome === 'failed') pending.reject(new Error('Old encoder check failed'));
		else pending.resolve(null);
		await pending.promise.catch(() => undefined);
		await tick();
		await expect.element(crop).toBeEnabled();
		await expect
			.element(screen.getByText(m.video_upload_editor_crop_unavailable()))
			.not.toBeInTheDocument();
	}
);

it('cancels file inspection when the dialog closes', async () => {
	const pending = Promise.withResolvers<VideoMetadata>();
	probe.mockImplementationOnce(() => pending.promise);
	const props = {
		open: true,
		file: new File(['video'], 'source.mp4', { type: 'video/mp4' }),
		onConfirm: vi.fn(),
		onSkip: vi.fn()
	};
	const screen = await render(VideoEditorDialog, props);
	await expect.element(screen.getByText(m.video_upload_editor_loading())).toBeVisible();
	await expect.poll(() => probe.mock.calls.length).toBe(1);
	await screen.rerender({ ...props, open: false });
	await expect.poll(() => probe.mock.calls[0]?.[1]?.aborted).toBe(true);
	pending.resolve(metadata);
	await tick();
	expect(codec).not.toHaveBeenCalled();
});
