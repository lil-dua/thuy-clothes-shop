import type { Route } from "./+types/sitemap";
import { getCategories } from "~/lib/db.server";

/**
 * sitemap.xml liệt kê những trang đáng để Google index: trang chủ, hai nhóm
 * đối tượng, danh sách tất cả, từng danh mục và từng sản phẩm đang bán.
 *
 * Cố ý bỏ qua giỏ hàng, thanh toán, tra cứu đơn và khu quản trị — trang phiên
 * làm việc hoặc trang riêng tư, index vào chỉ tổ rác kết quả tìm kiếm.
 */

interface Entry {
	path: string;
	lastmod?: string | null;
	changefreq: "daily" | "weekly" | "monthly";
	priority: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const origin = new URL(request.url).origin;

	const [categories, products] = await Promise.all([
		getCategories(db),
		db
			.prepare(
				`SELECT slug, updated_at FROM products
				 WHERE status = 'active'
				 ORDER BY updated_at DESC
				 LIMIT 5000`,
			)
			.all<{ slug: string; updated_at: string }>(),
	]);

	const entries: Entry[] = [
		{ path: "/", changefreq: "daily", priority: "1.0" },
		{ path: "/nu", changefreq: "daily", priority: "0.9" },
		{ path: "/tre-em", changefreq: "daily", priority: "0.9" },
		{ path: "/san-pham", changefreq: "daily", priority: "0.8" },
		...categories.map((category) => ({
			path: `/danh-muc/${category.slug}`,
			changefreq: "weekly" as const,
			priority: "0.7",
		})),
		...(products.results ?? []).map((product) => ({
			path: `/san-pham/${product.slug}`,
			lastmod: product.updated_at,
			changefreq: "weekly" as const,
			priority: "0.6",
		})),
		// Trang chính sách: đổi rất ít nhưng Google coi là tín hiệu shop đáng tin
		...["doi-tra", "van-chuyen", "bao-mat"].map((slug) => ({
			path: `/chinh-sach/${slug}`,
			changefreq: "monthly" as const,
			priority: "0.3",
		})),
	];

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => renderUrl(origin, entry)).join("\n")}
</urlset>
`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}

function renderUrl(origin: string, entry: Entry): string {
	// D1 lưu "2026-09-25 15:40:33"; sitemap cần ISO 8601 nên phải chuẩn hoá
	const lastmod = entry.lastmod
		? `\n    <lastmod>${entry.lastmod.replace(" ", "T")}Z</lastmod>`
		: "";

	return `  <url>
    <loc>${escapeXml(origin + entry.path)}</loc>${lastmod}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`;
}

/** Slug sinh từ slugify() chỉ có a-z0-9 và dấu gạch, nhưng thoát cho chắc */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
