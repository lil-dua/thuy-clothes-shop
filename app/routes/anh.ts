import type { Route } from "./+types/anh";

/**
 * Phục vụ ảnh sản phẩm từ R2.
 *
 * Ảnh đi qua worker thay vì mở public bucket, nhờ vậy domain ảnh trùng domain
 * shop (tốt cho SEO và không lộ tên bucket). Cache 1 năm + ETag nên Cloudflare
 * CDN giữ ảnh ở biên, worker hầu như không phải chạy lại.
 *
 * `IMAGES.get(key)` cho đọc BẤT KỲ key nào trong bucket nếu không tự giới
 * hạn — bucket này chỉ nên chứa ba "thư mục": `products/` (ảnh sản phẩm và
 * QR MoMo, xem `images.server.ts`), `settings/` (dự phòng, xem ghi chú
 * `uploadProductImage`) và `demo/` (ảnh minh hoạ do `scripts/seed-images.mjs`
 * tạo khi seed dữ liệu local — không do người dùng ghi được). Chặn `..`, ký
 * tự điều khiển và key quá dài để tránh dò/duyệt các key khác trong bucket.
 */
const ALLOWED_PREFIXES = ["products/", "settings/", "demo/"];
const MAX_KEY_LENGTH = 200;
// Cùng danh sách với ALLOWED_TYPES trong images.server.ts — Content-Type lưu
// trong R2 do server quyết định lúc upload (đã dò magic bytes), nhưng vẫn
// kiểm lại ở đây phòng khi có object cũ/khác lọt vào bucket.
//
// image/svg+xml CHỈ dùng cho ảnh minh hoạ ở `demo/` do scripts/seed-images.mjs
// sinh ra từ code có sẵn (app/lib/placeholder-shapes.ts) — không phải nội
// dung người dùng tải lên. Luồng upload thật (uploadProductImage) không nằm
// trong ALLOWED_TYPES của images.server.ts nên khách/chủ shop không thể tự
// đưa SVG (có thể chứa script) vào bucket qua trang quản trị.
const SAFE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
// SVG có thể chứa <script>/onload chạy trên origin của shop (nosniff không
// chặn được) — chỉ phục vụ inline cho ảnh minh hoạ tự sinh ở demo/, không bao
// giờ cho products/ hay settings/ (nơi có thể có object không mong muốn).
const SVG_TYPE = "image/svg+xml";

function isSafeKey(key: string): boolean {
	if (!key || key.length > MAX_KEY_LENGTH) return false;
	if (key.includes("..")) return false;
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f\x7f]/.test(key)) return false;
	return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isSafeImageType(contentType: string, key: string): boolean {
	if (SAFE_IMAGE_TYPES.has(contentType)) return true;
	return contentType === SVG_TYPE && key.startsWith("demo/");
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const key = params["*"];
	if (!isSafeKey(key ?? "")) throw new Response("Không tìm thấy ảnh", { status: 404 });

	const object = await context.cloudflare.env.IMAGES.get(key!);
	if (!object) throw new Response("Không tìm thấy ảnh", { status: 404 });

	const contentType = object.httpMetadata?.contentType ?? "";
	if (!isSafeImageType(contentType, key!)) {
		// Object không phải ảnh hợp lệ (không nên xảy ra qua luồng upload bình
		// thường) — không phục vụ inline, ép tải xuống thay vì render trong
		// trình duyệt.
		return new Response("Không tìm thấy ảnh", {
			status: 404,
			headers: { "Content-Disposition": "attachment" },
		});
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", "public, max-age=31536000, immutable");
	headers.set("X-Content-Type-Options", "nosniff");

	// Trình duyệt đã có bản mới nhất thì không cần gửi lại nội dung.
	if (request.headers.get("If-None-Match") === object.httpEtag) {
		return new Response(null, { status: 304, headers });
	}

	return new Response(object.body, { headers });
}
