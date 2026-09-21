/** Kiểu dữ liệu dùng chung, phản chiếu schema trong db/migrations/0001_init.sql */

export type TargetGroup = "women" | "kids";

export const TARGET_GROUPS: Record<TargetGroup, { label: string; slug: string }> = {
	women: { label: "Thời trang nữ", slug: "nu" },
	kids: { label: "Trẻ em", slug: "tre-em" },
};

export type ProductStatus = "active" | "hidden" | "discontinued";

/**
 * Cách sắp xếp danh sách sản phẩm.
 * Đặt ở đây (không phải db.server.ts) vì component phía client cũng cần nhãn —
 * import một giá trị runtime từ tệp *.server sẽ kéo mã server vào bundle trình duyệt.
 */
export type ProductSort = "newest" | "price_asc" | "price_desc" | "bestseller";

export const SORT_LABEL: Record<ProductSort, string> = {
	newest: "Mới nhất",
	price_asc: "Giá thấp đến cao",
	price_desc: "Giá cao đến thấp",
	bestseller: "Bán chạy",
};

export type PaymentMethod = "cod" | "bank_transfer" | "momo";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type OrderStatus =
	| "pending"
	| "confirmed"
	| "shipping"
	| "delivered"
	| "cancelled";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
	cod: "Thanh toán khi nhận hàng (COD)",
	bank_transfer: "Chuyển khoản qua QR (VietQR)",
	momo: "MoMo",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
	pending: "Chờ thanh toán",
	paid: "Đã thanh toán",
	failed: "Thất bại",
	refunded: "Đã hoàn tiền",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
	pending: "Chờ xác nhận",
	confirmed: "Đã xác nhận",
	shipping: "Đang giao",
	delivered: "Đã giao",
	cancelled: "Đã huỷ",
};

/** Thứ tự hợp lệ khi chuyển trạng thái đơn — dùng để chặn thao tác sai ở admin */
export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
	pending: ["confirmed", "cancelled"],
	confirmed: ["shipping", "cancelled"],
	shipping: ["delivered", "cancelled"],
	delivered: [],
	cancelled: [],
};

export interface Category {
	id: number;
	slug: string;
	name: string;
	target_group: TargetGroup;
	sort_order: number;
	is_active: number;
}

export interface CategoryWithCount extends Category {
	product_count: number;
}

export interface ProductVariant {
	id: number;
	product_id: number;
	size: string;
	color: string | null;
	color_hex: string | null;
	sku: string | null;
	quantity: number;
	sort_order: number;
	is_active: number;
}

export interface ProductImage {
	id: number;
	product_id: number;
	r2_key: string;
	color: string | null;
	alt: string | null;
	sort_order: number;
}

/** Bản rút gọn dùng cho lưới sản phẩm ở storefront */
export interface ProductListItem {
	id: number;
	slug: string;
	name: string;
	sale_price: number;
	compare_price: number | null;
	image_key: string | null;
	category_name: string | null;
	category_slug: string | null;
	target_group: TargetGroup | null;
	total_stock: number;
	sold_count: number;
}

/** Bản rút gọn dùng cho bảng sản phẩm ở admin — có thêm giá nhập & trạng thái */
export interface AdminProductListItem extends ProductListItem {
	cost_price: number;
	status: ProductStatus;
	created_at: string;
}

export interface Product {
	id: number;
	slug: string;
	name: string;
	description: string | null;
	detail: string | null;
	category_id: number | null;
	cost_price: number;
	sale_price: number;
	compare_price: number | null;
	is_featured: number;
	sold_count: number;
	status: ProductStatus;
	created_at: string;
	updated_at: string;
}

export interface ProductDetail extends Product {
	category_name: string | null;
	category_slug: string | null;
	target_group: TargetGroup | null;
	images: ProductImage[];
	variants: ProductVariant[];
	review_count: number;
	review_average: number | null;
}

export interface Customer {
	id: number;
	name: string | null;
	phone: string | null;
	address: string | null;
	threads_handle: string | null;
	note: string | null;
	order_count: number;
	total_spent: number;
	created_at: string;
}

export interface Order {
	id: number;
	order_code: string;
	customer_id: number | null;
	customer_name: string;
	customer_phone: string;
	customer_address: string;
	payment_method: PaymentMethod;
	payment_status: PaymentStatus;
	order_status: OrderStatus;
	subtotal: number;
	shipping_fee: number;
	discount_code: string | null;
	discount_amount: number;
	total: number;
	note: string | null;
	admin_note: string | null;
	reserved_until: string | null;
	paid_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface OrderItem {
	id: number;
	order_id: number;
	product_variant_id: number | null;
	product_id: number | null;
	product_name: string;
	product_slug: string | null;
	image_r2_key: string | null;
	size: string;
	color: string | null;
	unit_price: number;
	unit_cost: number;
	quantity: number;
	line_total: number;
}

export interface OrderWithItems extends Order {
	items: OrderItem[];
}

export interface DiscountCode {
	id: number;
	code: string;
	description: string | null;
	discount_type: "percent" | "amount";
	discount_value: number;
	max_discount: number | null;
	min_order: number;
	usage_limit: number | null;
	used_count: number;
	starts_at: string | null;
	ends_at: string | null;
	is_active: number;
	created_at: string;
}

export interface AdminUser {
	id: number;
	username: string;
	display_name: string;
	role: "owner" | "staff";
	is_active: number;
	last_login_at: string | null;
}

export interface ProductReview {
	id: number;
	product_id: number;
	author_name: string;
	rating: number;
	content: string | null;
	created_at: string;
}

/** Một dòng trong giỏ hàng lưu ở cookie — chỉ giữ id biến thể + số lượng */
export interface CartLine {
	variantId: number;
	quantity: number;
}

/** Dòng giỏ hàng đã nạp đủ thông tin từ DB để hiển thị */
export interface CartLineDetail {
	variantId: number;
	quantity: number;
	productId: number;
	productSlug: string;
	productName: string;
	imageKey: string | null;
	size: string;
	color: string | null;
	unitPrice: number;
	unitCost: number;
	lineTotal: number;
	/** Tồn kho hiện có — dùng để cảnh báo khi khách đặt quá số lượng còn lại */
	available: number;
}
