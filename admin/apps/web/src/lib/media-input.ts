/**
 * Shared attach-time media input rules.
 *
 * One implementation decides the size limit, the MIME allowlist with filename
 * inference, the dedup signature, and the capacity check for every file entry
 * point (device picker, drop, paste). Callers keep their own queue mechanics
 * and map the returned reason codes to user-visible messages.
 */

/** Default ceiling for non-video files (matches the server uploader limit). */
export const MEDIA_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

/** Default ceiling for video files (matches the server uploader limit). */
export const MEDIA_VIDEO_MAX_BYTES = 16 * 1024 * 1024 * 1024;

export interface MediaInputRules {
	/** Accepted MIME patterns, e.g. `['image/*', 'video/*']`. */
	accept: string[];
	/** Size ceiling for non-video files, in bytes. */
	maxBytes: number;
	/** Size ceiling for video files, in bytes. */
	maxVideoBytes: number;
	/** Total number of files allowed, including already-queued ones. */
	maxFiles: number;
}

export type MediaInputRejectionReason =
	| 'empty'
	| 'unsupported'
	| 'file_too_large'
	| 'video_too_large'
	| 'duplicate'
	| 'capacity';

export interface MediaInputRejection {
	reason: MediaInputRejectionReason;
}

export interface MediaInputSelection {
	accepted: File[];
	rejected: Array<{ file: File; reason: MediaInputRejectionReason }>;
}

type MediaFileIdentity = Pick<File, 'name' | 'size' | 'lastModified'>;
type MediaFileType = Pick<File, 'name' | 'type'>;

/**
 * Canonical dedup signature. NUL separators cannot appear in file names, so
 * unlike a naive colon join this cannot collide across distinct files.
 */
export function mediaFileSignature(file: MediaFileIdentity): string {
	return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/**
 * Best-effort MIME inference from the file extension, used when the browser
 * provides no (or a generic) MIME type.
 */
export function inferredMediaMime(name: string): string {
	if (/\.(png|jpe?g|gif|webp|avif|svg|heic|heif)$/i.test(name)) return 'image/unknown';
	if (/\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(name)) return 'video/unknown';
	if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return 'audio/unknown';
	return '';
}

export function isVideoMediaFile(file: MediaFileType): boolean {
	return file.type.startsWith('video/') || inferredMediaMime(file.name).startsWith('video/');
}

export function isMediaMimeAllowed(file: MediaFileType, accept: string[]): boolean {
	const inferred = inferredMediaMime(file.name);
	return accept.some((accepted) => {
		if (accepted === '*/*') return true;
		if (accepted.endsWith('/*')) {
			const prefix = accepted.slice(0, -1);
			return file.type.startsWith(prefix) || inferred.startsWith(prefix);
		}
		return file.type === accepted || inferred === accepted;
	});
}

/**
 * Validation for a single file: empty check, MIME allowlist (with filename
 * inference), then the video-aware size limit. Returns null when the file
 * may be attached. Dedup and capacity are handled by selectMediaInputFiles.
 */
export function mediaInputRejection(
	file: Pick<File, 'name' | 'size' | 'type'>,
	rules: MediaInputRules
): MediaInputRejection | null {
	if (file.size <= 0) return { reason: 'empty' };
	if (!isMediaMimeAllowed(file, rules.accept)) return { reason: 'unsupported' };
	const limit = isVideoMediaFile(file) ? rules.maxVideoBytes : rules.maxBytes;
	if (file.size > limit) {
		return { reason: isVideoMediaFile(file) ? 'video_too_large' : 'file_too_large' };
	}
	return null;
}

/**
 * Applies the shared rules to a batch: drops duplicates (against
 * existingSignatures and within the batch), rejects invalid files, and
 * enforces the total capacity. Duplicate and invalid files do not consume
 * capacity; only already-queued files and newly accepted ones do.
 */
export function selectMediaInputFiles(
	files: File[],
	rules: MediaInputRules,
	existingSignatures: Iterable<string> = []
): MediaInputSelection {
	const seen = new Set(existingSignatures);
	const maximum = Math.max(0, rules.maxFiles);
	let used = seen.size;
	const accepted: File[] = [];
	const rejected: MediaInputSelection['rejected'] = [];
	for (const file of files) {
		const signature = mediaFileSignature(file);
		if (seen.has(signature)) {
			rejected.push({ file, reason: 'duplicate' });
			continue;
		}
		seen.add(signature);
		const rejection = mediaInputRejection(file, rules);
		if (rejection) {
			rejected.push({ file, reason: rejection.reason });
			continue;
		}
		if (used >= maximum) {
			rejected.push({ file, reason: 'capacity' });
			continue;
		}
		used += 1;
		accepted.push(file);
	}
	return { accepted, rejected };
}
