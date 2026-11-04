import type { components } from '$lib/api/types';
import { m } from '$lib/paraglide/messages';
import { getLocaleTag } from './i18n';
import { formatBytes as formatByteSize } from './byte-size';

export type MediaListResponseItem = components['schemas']['MediaListItem'];
export type MediaUsageResponseItem = components['schemas']['MediaUsageItem'];

export interface MediaItem extends Omit<MediaListResponseItem, 'tags'> {
	tags: string[];
}

export interface MediaUsage {
	kind: string;
	id: string;
	label: string;
	content: string;
	status: string;
	scheduled_at: string;
}

export function normalizeMediaItem(item: MediaListResponseItem): MediaItem {
	return { ...item, tags: item.tags ?? [] };
}

export function normalizeMediaUsage(item: MediaUsageResponseItem): MediaUsage {
	return {
		kind: item.kind,
		id: item.id,
		label: item.label,
		content: item.content ?? '',
		status: item.status ?? '',
		scheduled_at: item.scheduled_at ?? ''
	};
}

export function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Binary-base (1024) byte display for the media library and inspector.
 * One-line call to the shared byte-size owner (issue #376); the signature
 * stays `(bytes) => string` because message-arg callers pass the result
 * directly. Non-finite input renders as an em dash, matching
 * `formatVideoDuration` in this module.
 */
export function formatSize(
	bytes: number,
	opts?: { locale?: string; maximumFractionDigits?: number }
): string {
	return (
		formatByteSize(bytes, {
			locale: opts?.locale ?? getLocaleTag(),
			maximumFractionDigits: opts?.maximumFractionDigits,
			base: 'iec'
		}) ?? '—'
	);
}

export function formatVideoDuration(milliseconds: number): string {
	if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '—';
	const totalSeconds = Math.round(milliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
		: `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function isImage(mimeType: string): boolean {
	return mimeType.startsWith('image/');
}

export function isVideo(mimeType: string): boolean {
	return mimeType.startsWith('video/');
}

export function isAudio(mimeType: string): boolean {
	return mimeType.startsWith('audio/');
}

export function mediaSourceLabel(value: string): string {
	switch (value) {
		case 'image_optimization':
		case 'image_fit':
		case 'media_copy':
			return m.media_copies();
		case 'camera':
			return m.media_camera();
		case 'image_editor_export':
			return m.media_image_editor_exports();
		case 'image_editor_edit':
			return m.media_image_editor_edits();
		case 'background_removal':
			return m.media_background_removal();
		case 'screenshot_template':
			return m.templates_title();
		case 'meme_generator':
			return m.media_picker_meme();
		default:
			return m.media_uploads();
	}
}

export function usageSummaryLabel(count: number) {
	return count === 1 ? m.media_usage_summary_one() : m.media_usage_summary_many({ count });
}

export function mediaUsageKindLabel(value: string): string {
	switch (value) {
		case 'publication':
			return m.media_usage_post();
		case 'design':
			return m.media_usage_design();
		case 'design_preview':
			return m.media_usage_design_preview();
		case 'design_page_export':
			return m.media_usage_design_page_export();
		case 'screenshot_template':
		case 'screenshot_template_export':
		case 'template':
			return m.media_usage_template();
		case 'template_preview':
			return m.media_usage_template_preview();
		case 'brand_asset':
			return m.media_usage_brand_asset();
		case 'brand_font':
			return m.media_usage_brand_font();
		default:
			return value.replaceAll('_', ' ');
	}
}

export function mediaUsageStatusLabel(status: string) {
	switch (status.toLowerCase()) {
		case 'published':
		case 'success':
			return m.activity_status_published();
		case 'failed':
			return m.activity_status_failed();
		case 'scheduled':
			return m.activity_status_scheduled();
		case 'publishing':
			return m.activity_status_publishing();
		case 'completed':
			return m.activity_status_completed();
		case 'processing':
			return m.activity_status_processing();
		case 'pending':
			return m.activity_status_pending();
		case 'draft':
			return m.activity_status_draft();
		default:
			return status;
	}
}

export function canDeleteMedia(media: MediaItem): boolean {
	return media.can_delete ?? media.usage_count === 0;
}
