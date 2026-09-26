/**
 * Nén ảnh ngay trong trình duyệt trước khi tải lên.
 *
 * Ảnh chụp bằng điện thoại thường 3–5MB. Không nén thì R2 đầy rất nhanh (gói
 * miễn phí 10GB chỉ chứa nổi khoảng 400 sản phẩm), và quan trọng hơn: khách
 * xem bằng 4G phải tải nguyên khối đó về. Một trang sản phẩm 6 ảnh là ~24MB.
 *
 * Nén ở phía trình duyệt nên không tốn thêm dịch vụ nào — Cloudflare Image
 * Resizing là tính năng trả phí.
 */

/** Ảnh sản phẩm hiển thị to nhất ở khung 4:5 trên desktop, 1400px là thừa đủ */
const MAX_WIDTH = 1400;
const QUALITY = 0.82;

/** Dưới ngưỡng này thì nén lại cũng chẳng lợi bao nhiêu, giữ nguyên bản gốc */
const SKIP_UNDER_BYTES = 300 * 1024;

export interface CompressResult {
	file: File;
	originalBytes: number;
	compressedBytes: number;
}

/**
 * Trả về ảnh đã thu nhỏ. Mọi lỗi đều rơi về ảnh gốc — nén chỉ là tối ưu, không
 * đáng để làm hỏng việc thêm sản phẩm.
 */
export async function compressImage(file: File): Promise<CompressResult> {
	const unchanged = { file, originalBytes: file.size, compressedBytes: file.size };

	if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return unchanged;
	if (file.size < SKIP_UNDER_BYTES) return unchanged;
	if (typeof createImageBitmap !== "function") return unchanged;

	try {
		// imageOrientation từ EXIF, nếu không ảnh chụp dọc bằng điện thoại sẽ
		// bị xoay ngang sau khi vẽ lại lên canvas.
		const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
		const scale = Math.min(1, MAX_WIDTH / bitmap.width);

		const canvas = document.createElement("canvas");
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);

		const context = canvas.getContext("2d");
		if (!context) return unchanged;
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", QUALITY),
		);
		if (!blob || blob.size >= file.size) return unchanged;

		const name = file.name.replace(/\.[^.]+$/, "") || "anh";
		return {
			file: new File([blob], `${name}.jpg`, { type: "image/jpeg" }),
			originalBytes: file.size,
			compressedBytes: blob.size,
		};
	} catch {
		return unchanged;
	}
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")}MB`;
	return `${Math.round(bytes / 1024)}KB`;
}
