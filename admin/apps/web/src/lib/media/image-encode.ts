import { m } from '$lib/paraglide/messages';

export type EncodedImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/** The Image Editor and network preparation share the same encoding and matte. */
export async function encodeImageCanvas(
	canvas: HTMLCanvasElement,
	type: EncodedImageType,
	quality: number,
	matteColor = '#ffffff'
): Promise<Blob> {
	let output = canvas;
	if (type === 'image/jpeg') {
		output = document.createElement('canvas');
		output.width = canvas.width;
		output.height = canvas.height;
		const context = output.getContext('2d');
		if (!context) throw new Error(m.image_editor_page_render_failed());
		context.fillStyle = matteColor;
		context.fillRect(0, 0, output.width, output.height);
		context.drawImage(canvas, 0, 0);
	}
	try {
		const blob = await new Promise<Blob>((resolve, reject) =>
			output.toBlob(
				(result) =>
					result ? resolve(result) : reject(new Error(m.image_editor_page_render_failed())),
				type,
				quality
			)
		);
		if (blob.type !== type) throw new Error(m.image_editor_page_render_failed());
		return blob;
	} finally {
		if (output !== canvas) {
			output.width = 0;
			output.height = 0;
		}
	}
}
