import {
	type RouteConfig,
	index,
	layout,
	prefix,
	route,
} from "@react-router/dev/routes";

/**
 * Một worker phục vụ cả hai giao diện:
 *   • Storefront (/...)      — tối ưu cho điện thoại, khách mua không cần đăng nhập
 *   • Quản trị  (/admin/...) — tối ưu cho laptop/PC, bắt buộc đăng nhập
 *
 * URL đặt bằng tiếng Việt không dấu cho thân thiện SEO và dễ đọc khi chia sẻ.
 */
export default [
	// --- Tài nguyên: ảnh sản phẩm đọc từ R2 -------------------------------
	route("anh/*", "routes/anh.ts"),
	route("anh-mac-dinh/:kind", "routes/anh-mac-dinh.ts"),

	// --- SEO ---------------------------------------------------------------
	route("robots.txt", "routes/robots.ts"),
	route("sitemap.xml", "routes/sitemap.ts"),

	// --- Thao tác giỏ hàng (resource route, không render UI) ---------------
	route("api/gio-hang", "routes/api.cart.ts"),

	// --- Storefront --------------------------------------------------------
	layout("routes/shop/layout.tsx", [
		index("routes/shop/home.tsx"),
		route("nu", "routes/shop/products.tsx", { id: "products-women" }),
		route("tre-em", "routes/shop/products.tsx", { id: "products-kids" }),
		route("san-pham", "routes/shop/products.tsx", { id: "products-all" }),
		route("danh-muc/:categorySlug", "routes/shop/products.tsx", {
			id: "products-category",
		}),
		route("san-pham/:slug", "routes/shop/product-detail.tsx"),
		route("gio-hang", "routes/shop/cart.tsx"),
		route("thanh-toan", "routes/shop/checkout.tsx"),
		route("don-hang/:code", "routes/shop/order-detail.tsx"),
		route("tra-cuu-don-hang", "routes/shop/order-lookup.tsx"),
	]),

	// --- Quản trị ----------------------------------------------------------
	// Đăng nhập/đăng xuất nằm ngoài layout admin vì chưa có phiên.
	route("admin/dang-nhap", "routes/admin/login.tsx"),
	route("admin/dang-xuat", "routes/admin/logout.ts"),

	layout("routes/admin/layout.tsx", [
		...prefix("admin", [
			index("routes/admin/dashboard.tsx"),
			route("san-pham", "routes/admin/products.tsx"),
			route("san-pham/moi", "routes/admin/product-new.tsx"),
			route("san-pham/:id", "routes/admin/product-edit.tsx"),
			route("don-hang", "routes/admin/orders.tsx"),
			route("don-hang/:id", "routes/admin/order-detail.tsx"),
			route("khach-hang", "routes/admin/customers.tsx"),
			route("khuyen-mai", "routes/admin/discounts.tsx"),
			route("danh-gia", "routes/admin/reviews.tsx"),
			route("bao-cao", "routes/admin/reports.tsx"),
			route("cai-dat", "routes/admin/settings.tsx"),
		]),
	]),
] satisfies RouteConfig;
