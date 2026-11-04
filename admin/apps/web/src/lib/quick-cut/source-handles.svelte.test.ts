import { expect, it, vi } from 'vitest';
import { restoreSourceHandles } from './project';
import type { QuickCutSourceMetadata } from './types';
import { saveHandle, deleteHandle } from '@openpost/editor-shared/workspace';

it('preserves legacy words for explicit relinking and upgrades verified source handles', async () => {
	const id = crypto.randomUUID();
	const root = await navigator.storage.getDirectory();
	const name = `legacy-${id}.mp4`;
	const handle = await root.getFileHandle(name, { create: true });
	const bytes = new Uint8Array(1024 * 1024).fill(7);
	const write = async () => {
		const stream = await handle.createWritable();
		await stream.write(bytes);
		await stream.close();
	};
	await write();
	await saveHandle({ kind: 'media', id: `quick-cut:${id}`, handle, name, pickedAt: 1 });
	const metadata: QuickCutSourceMetadata = {
		id,
		name,
		size: bytes.length,
		mimeType: 'video/mp4',
		duration: 10,
		width: 1920,
		height: 1080,
		videoCodec: 'avc',
		audioCodec: 'aac',
		sampleRate: 48000,
		channels: 2,
		rotation: 0,
		fps: 30,
		keyframeTimestamps: [],
		keyframeState: 'unknown',
		videoStreams: [],
		audioStreams: [],
		// A saved pre-versioning project without the optional modification time.
		contentFingerprint: 'bc1a89b22d29bab2722bfc723827e4ff029c55a0ad357a5ca7a0716a66be8322'
	};
	try {
		const transcript = { audioTrackIndex: 0, words: [{ text: 'Saved words', start: 0, end: 1 }] };
		const withTranscript = { ...metadata, transcript };
		const legacyFingerprint = metadata.contentFingerprint;
		bytes[128 * 1024] = 9;
		await write();
		expect((await restoreSourceHandles([withTranscript])).get(id)).toBeNull();
		expect(withTranscript.contentFingerprint).toBe(legacyFingerprint);
		expect(withTranscript.transcript).toEqual(transcript);
		bytes[128 * 1024] = 7;
		await write();
		const restored = (await restoreSourceHandles([metadata])).get(id);
		expect(restored).not.toBeNull();
		expect(await restored?.isSameEntry(handle)).toBe(true);
		expect(metadata.contentFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
		bytes[128 * 1024] = 9;
		await write();
		expect((await restoreSourceHandles([metadata])).get(id)).toBeNull();
		const reads = vi.spyOn(Blob.prototype, 'arrayBuffer');
		try {
			expect((await restoreSourceHandles([{ ...metadata, name: 'wrong.mp4' }])).get(id)).toBeNull();
			expect(reads).not.toHaveBeenCalled();
		} finally {
			reads.mockRestore();
		}
	} finally {
		await deleteHandle('media', `quick-cut:${id}`);
		await root.removeEntry(name);
	}
});
