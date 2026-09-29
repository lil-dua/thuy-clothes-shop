/** Tải ảnh sản phẩm lên R2 và phục vụ lại qua route /anh/* */

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB/ảnh

export type UploadResult =
	| { ok: true; key: string }
	| { ok: false; error: string };

/**
 * Lưu một file ảnh vào R2. Key có dạng `products/<slug>/<random>.<ext>`
 * để dễ đối chiếu khi cần dọn thủ công trong dashboard Cloudflare.
 *
 * `file.type` là do TRÌNH DUYỆT tự khai (đọc từ đuôi tên tệp), nên đổi tên
 * `.txt` thành `.jpg` và ép `Content-Type: image/jpeg` khi upload là đủ để
 * qua mặt nếu chỉ kiểm tra giá trị này. Loại ảnh thật sự lưu vào R2 luôn lấy
 * từ việc dò magic bytes ở đầu tệp — không bao giờ tin `file.type`.
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

	const sniffed = await sniffImageType(file);
	if (!sniffed || !ALLOWED_TYPES.has(sniffed)) {
		return { ok: false, error: `Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc AVIF` };
	}

	const extension = EXTENSION_BY_TYPE[sniffed] ?? "jpg";
	const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
	const key = `products/${productSlug || "san-pham"}/${random}.${extension}`;

	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: {
			// Content-Type lưu vào R2 do server quyết định (từ magic bytes), không
			// phải giá trị client tự khai.
			contentType: sniffed,
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

/**
 * Dò định dạng ảnh thật từ các byte đầu tệp (magic bytes / file signature).
 * Chỉ đọc 16 byte đầu — đủ cho cả 4 định dạng, không cần tải cả tệp vào bộ nhớ.
 */
async function sniffImageType(file: File): Promise<string | null> {
	const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());

	// JPEG: FF D8 FF
	if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
		return "image/jpeg";
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		head.length >= 8 &&
		head[0] === 0x89 &&
		head[1] === 0x50 &&
		head[2] === 0x4e &&
		head[3] === 0x47 &&
		head[4] === 0x0d &&
		head[5] === 0x0a &&
		head[6] === 0x1a &&
		head[7] === 0x0a
	) {
		return "image/png";
	}

	// WebP: "RIFF" ở byte 0, "WEBP" ở byte 8
	if (
		head.length >= 12 &&
		head[0] === 0x52 &&
		head[1] === 0x49 &&
		head[2] === 0x46 &&
		head[3] === 0x46 &&
		head[8] === 0x57 &&
		head[9] === 0x45 &&
		head[10] === 0x42 &&
		head[11] === 0x50
	) {
		return "image/webp";
	}

	// AVIF (ISOBMFF): "ftyp" ở byte 4, major brand "avif"/"avis" ở byte 8
	if (
		head.length >= 12 &&
		head[4] === 0x66 &&
		head[5] === 0x74 &&
		head[6] === 0x79 &&
		head[7] === 0x70 &&
		head[8] === 0x61 &&
		head[9] === 0x76 &&
		head[10] === 0x69 &&
		(head[11] === 0x66 || head[11] === 0x73)
	) {
		return "image/avif";
	}

	return null;
}

export async function deleteImage(bucket: R2Bucket, key: string): Promise<void> {
	await bucket.delete(key);
}
