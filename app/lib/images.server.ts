/** Tải ảnh sản phẩm lên R2 và phục vụ lại qua route /anh/* */

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB/ảnh

export type UploadResult =
	| { ok: true; key: string }
	| { ok: false; error: string };

/**
 * Lưu một file ảnh vào R2. Key có dạng `products/<slug>/<random>.<ext>`
 * để dễ đối chiếu khi cần dọn thủ công trong dashboard Cloudflare.
 */
export async function uploadProductImage(
	bucket: R2Bucket,
	file: File,
	productSlug: string,
): Promise<UploadResult> {
	if (!(file instanceof File) || file.size === 0) {
		return { ok: false, error: "Tệp ảnh không hợp lệ" };
	}
	if (file.size > MAX_SIZE_BYTES) {
		return { ok: false, error: `Ảnh "${file.name}" vượt quá 5MB` };
	}
	if (!ALLOWED_TYPES.has(file.type)) {
		return { ok: false, error: `Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc AVIF` };
	}

	const extension = EXTENSION_BY_TYPE[file.type] ?? "jpg";
	const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
	const key = `products/${productSlug || "san-pham"}/${random}.${extension}`;

	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: {
			contentType: file.type,
			cacheControl: "public, max-age=31536000, immutable",
		},
	});

	return { ok: true, key };
}

const EXTENSION_BY_TYPE: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/avif": "avif",
};

export async function deleteImage(bucket: R2Bucket, key: string): Promise<void> {
	await bucket.delete(key);
}
