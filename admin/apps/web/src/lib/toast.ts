import { toast, type ExternalToast } from 'svelte-sonner';

export type ToastTone = 'neutral' | 'success' | 'error' | 'info' | 'warning';

export function showToast(
	message: string,
	tone: ToastTone = 'neutral',
	options?: {
		actionLabel?: string;
		onAction?: () => void;
		position?: ExternalToast['position'];
		duration?: number;
		id?: string | number;
		description?: string;
		closeButton?: boolean;
	}
) {
	const data: ExternalToast = {};
	if (options?.position) data.position = options.position;
	if (options?.duration !== undefined) data.duration = options.duration;
	if (options?.id !== undefined) data.id = options.id;
	if (options?.description !== undefined) data.description = options.description;
	if (options?.closeButton !== undefined) data.closeButton = options.closeButton;
	if (options?.actionLabel && options.onAction) {
		data.action = { label: options.actionLabel, onClick: options.onAction };
	}
	return tone === 'success'
		? toast.success(message, data)
		: tone === 'error'
			? toast.error(message, data)
			: tone === 'info'
				? toast.info(message, data)
				: tone === 'warning'
					? toast.warning(message, data)
					: toast(message, data);
}

export function dismissToast(id?: string | number): void {
	toast.dismiss(id);
}
