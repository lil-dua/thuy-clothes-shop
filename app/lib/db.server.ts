/**
 * Lớp truy vấn D1. Mọi câu SQL của storefront + admin tập trung ở đây để
 * route chỉ lo hiển thị, và để đổi schema thì chỉ sửa một chỗ.
 *
 * Quy ước: luôn dùng `.bind()` cho giá trị từ người dùng — không nối chuỗi SQL.
 */

import type {
	AdminProductListItem,
	Category,
	CategoryWithCount,
	Order,
	OrderItem,
	OrderWithItems,
	Product,
	ProductDetail,
	ProductImage,
	ProductListItem,
	ProductReview,
	ProductSort,
	ProductVariant,
	TargetGroup,
} from "./types";

// ---------------------------------------------------------------------------
// Danh mục
// ---------------------------------------------------------------------------

export async function getCategories(db: D1Database): Promise<Category[]> {
	const { results } = await db
		.prepare(
			`SELECT id, slug, name, target_group, sort_order, is_active
			 FROM categories WHERE is_active = 1
			 ORDER BY target_group DESC, sort_order, name`,
		)
		.all<Category>();
	return results ?? [];
}

/** Danh mục kèm số sản phẩm đang bán — dùng cho bộ lọc storefront */
export async function getCategoriesWithCount(
	db: D1Database,
): Promise<CategoryWithCount[]> {
	const { results } = await db
		.prepare(
			`SELECT c.id, c.slug, c.name, c.target_group, c.sort_order, c.is_active,
			        COUNT(p.id) AS product_count
			 FROM categories c
			 LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
			 WHERE c.is_active = 1
			 GROUP BY c.id
			 ORDER BY c.target_group DESC, c.sort_order, c.name`,
		)
		.all<CategoryWithCount>();
	return results ?? [];
}

export async function getCategoryBySlug(
	db: D1Database,
	slug: string,
): Promise<Category | null> {
	return db
		.prepare(
			`SELECT id, slug, name, target_group, sort_order, is_active
			 FROM categories WHERE slug = ?1`,
		)
		.bind(slug)
		.first<Category>();
}

// ---------------------------------------------------------------------------
// Sản phẩm — storefront
// ---------------------------------------------------------------------------

const PRODUCT_LIST_COLUMNS = `
	p.id, p.slug, p.name, p.sale_price, p.compare_price, p.sold_count,
	c.name AS category_name, c.slug AS category_slug, c.target_group,
	(SELECT r2_key FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_key,
	(SELECT COALESCE(SUM(quantity), 0) FROM product_variants
	   WHERE product_id = p.id AND is_active = 1) AS total_stock
`;

export interface ProductFilters {
	targetGroup?: TargetGroup | null;
	categorySlug?: string | null;
	sizes?: string[];
	colors?: string[];
	priceMin?: number | null;
	priceMax?: number | null;
	search?: string | null;
	sort?: ProductSort;
	page?: number;
	perPage?: number;
	/** true = chỉ lấy sản phẩm còn hàng */
	inStockOnly?: boolean;
}

const SORT_SQL: Record<ProductSort, string> = {
	newest: "p.created_at DESC, p.id DESC",
	price_asc: "p.sale_price ASC, p.id DESC",
	price_desc: "p.sale_price DESC, p.id DESC",
	bestseller: "p.sold_count DESC, p.id DESC",
};

/**
 * Dựng mệnh đề WHERE + tham số từ bộ lọc.
 * Trả về đoạn SQL bắt đầu bằng "WHERE ..." và mảng tham số theo đúng thứ tự.
 */
function buildProductWhere(filters: ProductFilters): {
	where: string;
	params: unknown[];
} {
	const clauses: string[] = ["p.status = 'active'"];
	const params: unknown[] = [];

	if (filters.targetGroup) {
		params.push(filters.targetGroup);
		clauses.push(`c.target_group = ?${params.length}`);
	}
	if (filters.categorySlug) {
		params.push(filters.categorySlug);
		clauses.push(`c.slug = ?${params.length}`);
	}
	if (filters.priceMin != null) {
		params.push(filters.priceMin);
		clauses.push(`p.sale_price >= ?${params.length}`);
	}
	if (filters.priceMax != null) {
		params.push(filters.priceMax);
		clauses.push(`p.sale_price <= ?${params.length}`);
	}
	if (filters.search) {
		params.push(`%${filters.search}%`);
		clauses.push(`(p.name LIKE ?${params.length} COLLATE NOCASE)`);
	}
	if (filters.sizes?.length) {
		const holes = filters.sizes.map((size) => {
			params.push(size);
			return `?${params.length}`;
		});
		clauses.push(
			`EXISTS (SELECT 1 FROM product_variants v
			         WHERE v.product_id = p.id AND v.is_active = 1 AND v.quantity > 0 AND v.size IN (${holes.join(", ")}))`,
		);
	}
	if (filters.colors?.length) {
		const holes = filters.colors.map((color) => {
			params.push(color);
			return `?${params.length}`;
		});
		clauses.push(
			`EXISTS (SELECT 1 FROM product_variants v
			         WHERE v.product_id = p.id AND v.is_active = 1 AND v.quantity > 0 AND v.color IN (${holes.join(", ")}))`,
		);
	}
	if (filters.inStockOnly) {
		clauses.push(
			`EXISTS (SELECT 1 FROM product_variants v
			         WHERE v.product_id = p.id AND v.is_active = 1 AND v.quantity > 0)`,
		);
	}

	return { where: `WHERE ${clauses.join(" AND ")}`, params };
}

export async function listProducts(
	db: D1Database,
	filters: ProductFilters = {},
): Promise<{ items: ProductListItem[]; total: number; page: number; perPage: number }> {
	const page = Math.max(1, filters.page ?? 1);
	const perPage = Math.min(60, Math.max(1, filters.perPage ?? 12));
	const { where, params } = buildProductWhere(filters);
	const orderBy = SORT_SQL[filters.sort ?? "newest"];

	const countRow = await db
		.prepare(
			`SELECT COUNT(*) AS total FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 ${where}`,
		)
		.bind(...params)
		.first<{ total: number }>();

	const listParams = [...params, perPage, (page - 1) * perPage];
	const { results } = await db
		.prepare(
			`SELECT ${PRODUCT_LIST_COLUMNS}
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 ${where}
			 ORDER BY ${orderBy}
			 LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
		)
		.bind(...listParams)
		.all<ProductListItem>();

	return {
		items: results ?? [],
		total: countRow?.total ?? 0,
		page,
		perPage,
	};
}

export async function getFeaturedProducts(
	db: D1Database,
	limit = 8,
	targetGroup?: TargetGroup | null,
): Promise<ProductListItem[]> {
	const params: unknown[] = [];
	let groupClause = "";
	if (targetGroup) {
		params.push(targetGroup);
		groupClause = `AND c.target_group = ?${params.length}`;
	}
	params.push(limit);

	const { results } = await db
		.prepare(
			`SELECT ${PRODUCT_LIST_COLUMNS}
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 WHERE p.status = 'active' AND p.is_featured = 1 ${groupClause}
			 ORDER BY p.sold_count DESC, p.created_at DESC
			 LIMIT ?${params.length}`,
		)
		.bind(...params)
		.all<ProductListItem>();
	return results ?? [];
}

export async function getNewestProducts(
	db: D1Database,
	limit = 8,
): Promise<ProductListItem[]> {
	const { results } = await db
		.prepare(
			`SELECT ${PRODUCT_LIST_COLUMNS}
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 WHERE p.status = 'active'
			 ORDER BY p.created_at DESC, p.id DESC
			 LIMIT ?1`,
		)
		.bind(limit)
		.all<ProductListItem>();
	return results ?? [];
}

export async function getProductBySlug(
	db: D1Database,
	slug: string,
	{ includeHidden = false } = {},
): Promise<ProductDetail | null> {
	const statusClause = includeHidden ? "" : "AND p.status = 'active'";
	const product = await db
		.prepare(
			`SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.target_group
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 WHERE p.slug = ?1 ${statusClause}`,
		)
		.bind(slug)
		.first<Product & {
			category_name: string | null;
			category_slug: string | null;
			target_group: TargetGroup | null;
		}>();

	if (!product) return null;

	const [images, variants, reviewStats] = await Promise.all([
		getProductImages(db, product.id),
		getProductVariants(db, product.id),
		db
			.prepare(
				`SELECT COUNT(*) AS review_count, AVG(rating) AS review_average
				 FROM product_reviews WHERE product_id = ?1 AND is_visible = 1`,
			)
			.bind(product.id)
			.first<{ review_count: number; review_average: number | null }>(),
	]);

	return {
		...product,
		images,
		variants,
		review_count: reviewStats?.review_count ?? 0,
		review_average: reviewStats?.review_average ?? null,
	};
}

export async function getProductImages(
	db: D1Database,
	productId: number,
): Promise<ProductImage[]> {
	const { results } = await db
		.prepare(
			`SELECT id, product_id, r2_key, color, alt, sort_order
			 FROM product_images WHERE product_id = ?1 ORDER BY sort_order, id`,
		)
		.bind(productId)
		.all<ProductImage>();
	return results ?? [];
}

export async function getProductVariants(
	db: D1Database,
	productId: number,
	{ includeHidden = false } = {},
): Promise<ProductVariant[]> {
	const activeClause = includeHidden ? "" : "AND is_active = 1";
	const { results } = await db
		.prepare(
			`SELECT id, product_id, size, color, color_hex, sku, quantity, sort_order, is_active
			 FROM product_variants WHERE product_id = ?1 ${activeClause}
			 ORDER BY sort_order, id`,
		)
		.bind(productId)
		.all<ProductVariant>();
	return results ?? [];
}

export async function getProductReviews(
	db: D1Database,
	productId: number,
	limit = 10,
): Promise<ProductReview[]> {
	const { results } = await db
		.prepare(
			`SELECT id, product_id, author_name, rating, content, created_at
			 FROM product_reviews
			 WHERE product_id = ?1 AND is_visible = 1
			 ORDER BY created_at DESC LIMIT ?2`,
		)
		.bind(productId, limit)
		.all<ProductReview>();
	return results ?? [];
}

/** Sản phẩm gợi ý: cùng danh mục, loại trừ chính nó */
export async function getRelatedProducts(
	db: D1Database,
	productId: number,
	categoryId: number | null,
	limit = 4,
): Promise<ProductListItem[]> {
	if (!categoryId) return [];
	const { results } = await db
		.prepare(
			`SELECT ${PRODUCT_LIST_COLUMNS}
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 WHERE p.status = 'active' AND p.category_id = ?1 AND p.id != ?2
			 ORDER BY p.sold_count DESC, p.created_at DESC
			 LIMIT ?3`,
		)
		.bind(categoryId, productId, limit)
		.all<ProductListItem>();
	return results ?? [];
}

/** Các giá trị size/màu đang có hàng — dựng bộ lọc động thay vì hard-code */
export async function getFilterFacets(
	db: D1Database,
	targetGroup?: TargetGroup | null,
): Promise<{ sizes: string[]; colors: { name: string; hex: string | null }[] }> {
	const params: unknown[] = [];
	let groupClause = "";
	if (targetGroup) {
		params.push(targetGroup);
		groupClause = `AND c.target_group = ?${params.length}`;
	}

	const [sizeRows, colorRows] = await Promise.all([
		db
			.prepare(
				`SELECT DISTINCT v.size, MIN(v.sort_order) AS ord
				 FROM product_variants v
				 JOIN products p ON p.id = v.product_id AND p.status = 'active'
				 LEFT JOIN categories c ON c.id = p.category_id
				 WHERE v.is_active = 1 AND v.quantity > 0 ${groupClause}
				 GROUP BY v.size ORDER BY ord, v.size`,
			)
			.bind(...params)
			.all<{ size: string }>(),
		db
			.prepare(
				`SELECT v.color AS name, MAX(v.color_hex) AS hex
				 FROM product_variants v
				 JOIN products p ON p.id = v.product_id AND p.status = 'active'
				 LEFT JOIN categories c ON c.id = p.category_id
				 WHERE v.is_active = 1 AND v.quantity > 0 AND v.color IS NOT NULL AND v.color != '' ${groupClause}
				 GROUP BY v.color ORDER BY v.color`,
			)
			.bind(...params)
			.all<{ name: string; hex: string | null }>(),
	]);

	return {
		sizes: (sizeRows.results ?? []).map((row) => row.size),
		colors: colorRows.results ?? [],
	};
}

// ---------------------------------------------------------------------------
// Sản phẩm — admin
// ---------------------------------------------------------------------------

export interface AdminProductFilters {
	search?: string | null;
	categoryId?: number | null;
	status?: string | null;
	page?: number;
	perPage?: number;
}

export async function listAdminProducts(
	db: D1Database,
	filters: AdminProductFilters = {},
): Promise<{ items: AdminProductListItem[]; total: number; page: number; perPage: number }> {
	const page = Math.max(1, filters.page ?? 1);
	const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));
	const clauses: string[] = ["1 = 1"];
	const params: unknown[] = [];

	if (filters.search) {
		params.push(`%${filters.search}%`);
		clauses.push(`p.name LIKE ?${params.length} COLLATE NOCASE`);
	}
	if (filters.categoryId) {
		params.push(filters.categoryId);
		clauses.push(`p.category_id = ?${params.length}`);
	}
	if (filters.status) {
		params.push(filters.status);
		clauses.push(`p.status = ?${params.length}`);
	}
	const where = `WHERE ${clauses.join(" AND ")}`;

	const countRow = await db
		.prepare(`SELECT COUNT(*) AS total FROM products p ${where}`)
		.bind(...params)
		.first<{ total: number }>();

	const { results } = await db
		.prepare(
			`SELECT ${PRODUCT_LIST_COLUMNS}, p.cost_price, p.status, p.created_at
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 ${where}
			 ORDER BY p.created_at DESC, p.id DESC
			 LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
		)
		.bind(...params, perPage, (page - 1) * perPage)
		.all<AdminProductListItem>();

	return { items: results ?? [], total: countRow?.total ?? 0, page, perPage };
}

export async function getProductById(
	db: D1Database,
	id: number,
): Promise<ProductDetail | null> {
	const product = await db
		.prepare(
			`SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.target_group
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 WHERE p.id = ?1`,
		)
		.bind(id)
		.first<Product & {
			category_name: string | null;
			category_slug: string | null;
			target_group: TargetGroup | null;
		}>();
	if (!product) return null;

	const [images, variants] = await Promise.all([
		getProductImages(db, id),
		getProductVariants(db, id, { includeHidden: true }),
	]);
	return { ...product, images, variants, review_count: 0, review_average: null };
}

/** Bảo đảm slug là duy nhất bằng cách thêm hậu tố -2, -3... khi trùng */
export async function ensureUniqueSlug(
	db: D1Database,
	base: string,
	excludeId?: number,
): Promise<string> {
	const fallback = base || "san-pham";
	for (let suffix = 0; suffix < 50; suffix++) {
		const candidate = suffix === 0 ? fallback : `${fallback}-${suffix + 1}`;
		const row = await db
			.prepare(`SELECT id FROM products WHERE slug = ?1`)
			.bind(candidate)
			.first<{ id: number }>();
		if (!row || row.id === excludeId) return candidate;
	}
	return `${fallback}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Đơn hàng
// ---------------------------------------------------------------------------

export interface OrderFilters {
	search?: string | null;
	orderStatus?: string | null;
	paymentStatus?: string | null;
	page?: number;
	perPage?: number;
}

export async function listOrders(
	db: D1Database,
	filters: OrderFilters = {},
): Promise<{ items: Order[]; total: number; page: number; perPage: number }> {
	const page = Math.max(1, filters.page ?? 1);
	const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));
	const clauses: string[] = ["1 = 1"];
	const params: unknown[] = [];

	if (filters.search) {
		params.push(`%${filters.search}%`);
		const hole = `?${params.length}`;
		clauses.push(
			`(o.order_code LIKE ${hole} COLLATE NOCASE
			  OR o.customer_name LIKE ${hole} COLLATE NOCASE
			  OR o.customer_phone LIKE ${hole})`,
		);
	}
	if (filters.orderStatus) {
		params.push(filters.orderStatus);
		clauses.push(`o.order_status = ?${params.length}`);
	}
	if (filters.paymentStatus) {
		params.push(filters.paymentStatus);
		clauses.push(`o.payment_status = ?${params.length}`);
	}
	const where = `WHERE ${clauses.join(" AND ")}`;

	const countRow = await db
		.prepare(`SELECT COUNT(*) AS total FROM orders o ${where}`)
		.bind(...params)
		.first<{ total: number }>();

	const { results } = await db
		.prepare(
			`SELECT o.* FROM orders o ${where}
			 ORDER BY o.created_at DESC, o.id DESC
			 LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
		)
		.bind(...params, perPage, (page - 1) * perPage)
		.all<Order>();

	return { items: results ?? [], total: countRow?.total ?? 0, page, perPage };
}

export async function getOrderByCode(
	db: D1Database,
	code: string,
): Promise<OrderWithItems | null> {
	const order = await db
		.prepare(`SELECT * FROM orders WHERE order_code = ?1`)
		.bind(code.trim().toUpperCase())
		.first<Order>();
	if (!order) return null;
	return { ...order, items: await getOrderItems(db, order.id) };
}

export async function getOrderById(
	db: D1Database,
	id: number,
): Promise<OrderWithItems | null> {
	const order = await db
		.prepare(`SELECT * FROM orders WHERE id = ?1`)
		.bind(id)
		.first<Order>();
	if (!order) return null;
	return { ...order, items: await getOrderItems(db, order.id) };
}

export async function getOrderItems(
	db: D1Database,
	orderId: number,
): Promise<OrderItem[]> {
	const { results } = await db
		.prepare(`SELECT * FROM order_items WHERE order_id = ?1 ORDER BY id`)
		.bind(orderId)
		.all<OrderItem>();
	return results ?? [];
}

// ---------------------------------------------------------------------------
// Khách hàng
// ---------------------------------------------------------------------------

export async function listCustomers(
	db: D1Database,
	{ search, page = 1, perPage = 20 }: { search?: string | null; page?: number; perPage?: number } = {},
) {
	const clauses: string[] = ["1 = 1"];
	const params: unknown[] = [];
	if (search) {
		params.push(`%${search}%`);
		const hole = `?${params.length}`;
		clauses.push(`(name LIKE ${hole} COLLATE NOCASE OR phone LIKE ${hole})`);
	}
	const where = `WHERE ${clauses.join(" AND ")}`;

	const countRow = await db
		.prepare(`SELECT COUNT(*) AS total FROM customers ${where}`)
		.bind(...params)
		.first<{ total: number }>();

	const { results } = await db
		.prepare(
			`SELECT * FROM customers ${where}
			 ORDER BY total_spent DESC, id DESC
			 LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
		)
		.bind(...params, perPage, (page - 1) * perPage)
		.all();

	return { items: results ?? [], total: countRow?.total ?? 0, page, perPage };
}
