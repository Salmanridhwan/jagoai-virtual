import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

// Hash every byte without buffering the entire source in memory. Sampled hashes
// cannot safely validate cached transcripts or relinked media.
export async function createHash(file: File, signal?: AbortSignal): Promise<string> {
	const hash = sha256.create();
	const chunkSize = 256 * 1024;
	for (let offset = 0; offset < file.size; offset += chunkSize) {
		signal?.throwIfAborted();
		const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
		signal?.throwIfAborted();
		hash.update(new Uint8Array(chunk));
	}
	signal?.throwIfAborted();
	return `sha256:${bytesToHex(hash.digest())}`;
}

// Only saved projects use the legacy comparison, then establish a full-file baseline.
export async function matchFingerprint(file: File, expected: string): Promise<string | null> {
	const current = await createHash(file);
	if (expected.startsWith('sha256:')) return current === expected ? current : null;
	if (!/^[0-9a-f]{64}$/u.test(expected)) return null;

	const chunkSize = 65536;
	const samples = [file.slice(0, Math.min(chunkSize, file.size))];
	if (file.size > chunkSize * 2) {
		const middle = Math.floor(file.size / 2) - Math.floor(chunkSize / 2);
		samples.push(file.slice(middle, middle + chunkSize));
	}
	if (file.size > chunkSize) samples.push(file.slice(Math.max(0, file.size - chunkSize)));
	const legacy = sha256.create();
	for (const sample of samples) legacy.update(new Uint8Array(await sample.arrayBuffer()));
	legacy.update(new TextEncoder().encode(String(file.size)));
	return bytesToHex(legacy.digest()) === expected ? current : null;
}
