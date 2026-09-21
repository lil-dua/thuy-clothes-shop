import type { Route } from "./+types/anh";

/**
 * Phục vụ ảnh sản phẩm từ R2.
 *
 * Ảnh đi qua worker thay vì mở public bucket, nhờ vậy domain ảnh trùng domain
 * shop (tốt cho SEO và không lộ tên bucket). Cache 1 năm + ETag nên Cloudflare
 * CDN giữ ảnh ở biên, worker hầu như không phải chạy lại.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
	const key = params["*"];
	if (!key) throw new Response("Không tìm thấy ảnh", { status: 404 });

	const object = await context.cloudflare.env.IMAGES.get(key);
	if (!object) throw new Response("Không tìm thấy ảnh", { status: 404 });

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", "public, max-age=31536000, immutable");

	// Trình duyệt đã có bản mới nhất thì không cần gửi lại nội dung.
	if (request.headers.get("If-None-Match") === object.httpEtag) {
		return new Response(null, { status: 304, headers });
	}

	return new Response(object.body, { headers });
}
