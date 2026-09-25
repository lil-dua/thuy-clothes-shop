import type { Route } from "./+types/robots";

/**
 * robots.txt sinh động theo domain đang chạy, để bản trên workers.dev và bản
 * trên domain riêng đều trỏ đúng sitemap của chính nó.
 *
 * Chặn crawler ở những nhánh không nên nằm trên Google:
 *   /admin      — khu vực quản trị
 *   /don-hang/  — chứa tên, số điện thoại, địa chỉ khách
 *   /gio-hang, /thanh-toan — trang phiên làm việc, index vào vô nghĩa
 */
export function loader({ request }: Route.LoaderArgs) {
	const origin = new URL(request.url).origin;

	const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /don-hang/
Disallow: /gio-hang
Disallow: /thanh-toan
Disallow: /tra-cuu-don-hang

Sitemap: ${origin}/sitemap.xml
`;

	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
