/**
 * Số liệu cho trang Tổng quan và Báo cáo.
 *
 * Quy ước tính doanh thu: lấy mọi đơn CHƯA huỷ trong kỳ. Đơn đã huỷ không
 * tính, kể cả đơn tự huỷ do quá hạn chuyển khoản.
 * Lợi nhuận = (giá bán − giá nhập) × số lượng, TRỪ đi tiền đã giảm giá.
 * Giá nhập lấy từ snapshot trong order_items nên đổi giá nhập hôm nay không
 * làm sai lệch lợi nhuận của đơn cũ. Phí vận chuyển không tính vào đây vì shop
 * thu hộ rồi trả lại cho đơn vị giao hàng.
 */

const NOT_CANCELLED = `o.order_status != 'cancelled'`;

export interface PeriodStats {
	revenue: number;
	profit: number;
	orderCount: number;
	itemCount: number;
	newCustomers: number;
}

/** `from`/`to` theo định dạng 'YYYY-MM-DD', tính theo giờ UTC như D1 lưu */
export async function getPeriodStats(
	db: D1Database,
	from: string,
	to: string,
): Promise<PeriodStats> {
	const [orders, items, customers] = await Promise.all([
		db
			.prepare(
				`SELECT COALESCE(SUM(o.total), 0) AS revenue,
				        COALESCE(SUM(o.discount_amount), 0) AS discount_total,
				        COUNT(*) AS order_count
				 FROM orders o
				 WHERE ${NOT_CANCELLED} AND date(o.created_at) BETWEEN ?1 AND ?2`,
			)
			.bind(from, to)
			.first<{ revenue: number; discount_total: number; order_count: number }>(),
		db
			.prepare(
				`SELECT COALESCE(SUM((oi.unit_price - oi.unit_cost) * oi.quantity), 0) AS profit,
				        COALESCE(SUM(oi.quantity), 0) AS item_count
				 FROM order_items oi
				 JOIN orders o ON o.id = oi.order_id
				 WHERE ${NOT_CANCELLED} AND date(o.created_at) BETWEEN ?1 AND ?2`,
			)
			.bind(from, to)
			.first<{ profit: number; item_count: number }>(),
		db
			.prepare(
				`SELECT COUNT(*) AS total FROM customers
				 WHERE date(created_at) BETWEEN ?1 AND ?2`,
			)
			.bind(from, to)
			.first<{ total: number }>(),
	]);

	return {
		revenue: orders?.revenue ?? 0,
		profit: (items?.profit ?? 0) - (orders?.discount_total ?? 0),
		orderCount: orders?.order_count ?? 0,
		itemCount: items?.item_count ?? 0,
		newCustomers: customers?.total ?? 0,
	};
}

export interface RevenuePoint {
	day: string;
	revenue: number;
	orders: number;
}

export async function getRevenueByDay(
	db: D1Database,
	from: string,
	to: string,
): Promise<RevenuePoint[]> {
	const { results } = await db
		.prepare(
			`SELECT date(o.created_at) AS day,
			        COALESCE(SUM(o.total), 0) AS revenue,
			        COUNT(*) AS orders
			 FROM orders o
			 WHERE ${NOT_CANCELLED} AND date(o.created_at) BETWEEN ?1 AND ?2
			 GROUP BY day ORDER BY day`,
		)
		.bind(from, to)
		.all<RevenuePoint>();
	return results ?? [];
}

export interface TopProduct {
	product_id: number | null;
	product_name: string;
	product_slug: string | null;
	image_r2_key: string | null;
	quantity: number;
	revenue: number;
}

export async function getTopProducts(
	db: D1Database,
	from: string,
	to: string,
	limit = 5,
): Promise<TopProduct[]> {
	const { results } = await db
		.prepare(
			`SELECT oi.product_id, oi.product_name, MIN(oi.product_slug) AS product_slug,
			        MIN(oi.image_r2_key) AS image_r2_key,
			        SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue
			 FROM order_items oi
			 JOIN orders o ON o.id = oi.order_id
			 WHERE ${NOT_CANCELLED} AND date(o.created_at) BETWEEN ?1 AND ?2
			 GROUP BY oi.product_name
			 ORDER BY quantity DESC LIMIT ?3`,
		)
		.bind(from, to, limit)
		.all<TopProduct>();
	return results ?? [];
}

/**
 * Tiền hàng tách theo nhóm đối tượng — trục phân loại chính của shop.
 * Đây là tổng giá trị sản phẩm, CHƯA trừ giảm giá và chưa cộng phí ship, nên
 * cố ý không trùng với con số "Tổng doanh thu".
 */
export async function getRevenueByTargetGroup(
	db: D1Database,
	from: string,
	to: string,
): Promise<{ target_group: string | null; revenue: number; quantity: number }[]> {
	const { results } = await db
		.prepare(
			`SELECT c.target_group, COALESCE(SUM(oi.line_total), 0) AS revenue,
			        COALESCE(SUM(oi.quantity), 0) AS quantity
			 FROM order_items oi
			 JOIN orders o ON o.id = oi.order_id
			 LEFT JOIN products p ON p.id = oi.product_id
			 LEFT JOIN categories c ON c.id = p.category_id
			 WHERE ${NOT_CANCELLED} AND date(o.created_at) BETWEEN ?1 AND ?2
			 GROUP BY c.target_group`,
		)
		.bind(from, to)
		.all<{ target_group: string | null; revenue: number; quantity: number }>();
	return results ?? [];
}

export interface LowStockVariant {
	variant_id: number;
	product_id: number;
	product_name: string;
	size: string;
	color: string | null;
	quantity: number;
}

/** Cảnh báo sắp hết hàng theo từng size — mục "Vận hành" trong kế hoạch */
export async function getLowStockVariants(
	db: D1Database,
	threshold = 3,
	limit = 20,
): Promise<LowStockVariant[]> {
	const { results } = await db
		.prepare(
			`SELECT v.id AS variant_id, v.product_id, p.name AS product_name,
			        v.size, v.color, v.quantity
			 FROM product_variants v
			 JOIN products p ON p.id = v.product_id
			 WHERE p.status = 'active' AND v.quantity <= ?1
			 ORDER BY v.quantity ASC, p.name LIMIT ?2`,
		)
		.bind(threshold, limit)
		.all<LowStockVariant>();
	return results ?? [];
}

/** So sánh hai kỳ: trả về % thay đổi, null khi kỳ trước bằng 0 */
export function percentChange(current: number, previous: number): number | null {
	if (previous === 0) return current > 0 ? null : 0;
	return Math.round(((current - previous) / previous) * 100);
}

/** Khoảng ngày của một tháng dạng 'YYYY-MM' */
export function monthRange(month: string): { from: string; to: string } {
	const [year, monthIndex] = month.split("-").map(Number);
	const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
	return {
		from: `${month}-01`,
		to: `${month}-${String(lastDay).padStart(2, "0")}`,
	};
}

/** Tháng liền trước, dạng 'YYYY-MM' */
export function previousMonth(month: string): string {
	const [year, monthIndex] = month.split("-").map(Number);
	const date = new Date(Date.UTC(year, monthIndex - 2, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Tháng hiện tại theo giờ Việt Nam, dạng 'YYYY-MM' */
export function currentMonth(): string {
	const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
