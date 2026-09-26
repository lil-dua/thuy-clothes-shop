/**
 * Đánh giá sản phẩm.
 *
 * Chỉ người ĐÃ MUA và ĐÃ NHẬN hàng mới đánh giá được: biểu mẫu nằm trong trang
 * theo dõi đơn, mà trang đó chỉ mở cho trình duyệt vừa đặt hoặc vừa xác minh số
 * điện thoại. Nhờ vậy không cần captcha, không cần duyệt trước, và mọi đánh giá
 * đều gắn với một đơn có thật.
 */

import type { ProductReview } from "./types";

export interface ReviewableItem {
	productId: number;
	productName: string;
	productSlug: string | null;
	imageKey: string | null;
	/** Đánh giá đã gửi cho sản phẩm này trong đơn này, nếu có */
	review: { rating: number; content: string | null } | null;
}

/**
 * Các sản phẩm trong đơn mà khách đánh giá được, kèm đánh giá đã gửi (nếu có).
 * Một đơn có thể chứa hai dòng cùng sản phẩm khác size — gộp lại thành một.
 */
export async function getReviewableItems(
	db: D1Database,
	orderId: number,
): Promise<ReviewableItem[]> {
	const { results } = await db
		.prepare(
			`SELECT oi.product_id, oi.product_name, MIN(oi.product_slug) AS product_slug,
			        MIN(oi.image_r2_key) AS image_key,
			        r.rating, r.content
			 FROM order_items oi
			 LEFT JOIN product_reviews r
			   ON r.order_id = oi.order_id AND r.product_id = oi.product_id
			 WHERE oi.order_id = ?1 AND oi.product_id IS NOT NULL
			 GROUP BY oi.product_id
			 ORDER BY MIN(oi.id)`,
		)
		.bind(orderId)
		.all<{
			product_id: number;
			product_name: string;
			product_slug: string | null;
			image_key: string | null;
			rating: number | null;
			content: string | null;
		}>();

	return (results ?? []).map((row) => ({
		productId: row.product_id,
		productName: row.product_name,
		productSlug: row.product_slug,
		imageKey: row.image_key,
		review: row.rating != null ? { rating: row.rating, content: row.content } : null,
	}));
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

/**
 * Ghi đánh giá cho một sản phẩm trong đơn.
 *
 * Gửi lại cho cùng sản phẩm sẽ ghi đè đánh giá cũ thay vì tạo thêm dòng mới —
 * khách đổi ý về số sao là chuyện bình thường, và ràng buộc UNIQUE ở migration
 * 0004 cũng chặn trùng ở tầng dữ liệu.
 */
export async function submitReview(
	db: D1Database,
	{
		orderId,
		productId,
		authorName,
		rating,
		content,
	}: {
		orderId: number;
		productId: number;
		authorName: string;
		rating: number;
		content: string | null;
	},
): Promise<SubmitResult> {
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		return { ok: false, error: "Vui lòng chọn số sao từ 1 đến 5" };
	}

	// Chốt chặn phía server: sản phẩm phải thực sự nằm trong đơn này, và đơn
	// phải đã giao. Không tin dữ liệu form gửi lên.
	const allowed = await db
		.prepare(
			`SELECT 1 AS ok FROM order_items oi
			 JOIN orders o ON o.id = oi.order_id
			 WHERE oi.order_id = ?1 AND oi.product_id = ?2
			   AND o.order_status = 'delivered'`,
		)
		.bind(orderId, productId)
		.first();

	if (!allowed) {
		return { ok: false, error: "Chỉ đánh giá được sản phẩm trong đơn đã giao" };
	}

	await db
		.prepare(
			`INSERT INTO product_reviews (product_id, order_id, author_name, rating, content)
			 VALUES (?1, ?2, ?3, ?4, ?5)
			 ON CONFLICT(order_id, product_id) DO UPDATE SET
			   rating = excluded.rating,
			   content = excluded.content,
			   author_name = excluded.author_name,
			   created_at = datetime('now')`,
		)
		.bind(productId, orderId, authorName.trim().slice(0, 60) || "Khách hàng", rating, content)
		.run();

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Phía quản trị
// ---------------------------------------------------------------------------

export interface AdminReview extends ProductReview {
	is_visible: number;
	product_name: string | null;
	product_slug: string | null;
	order_code: string | null;
}

export async function listReviews(
	db: D1Database,
	{ visible, page = 1, perPage = 30 }: { visible?: string | null; page?: number; perPage?: number } = {},
): Promise<{ items: AdminReview[]; total: number; page: number; perPage: number }> {
	const clauses: string[] = ["1 = 1"];
	const params: unknown[] = [];

	if (visible === "hidden") clauses.push("r.is_visible = 0");
	else if (visible === "shown") clauses.push("r.is_visible = 1");

	const where = `WHERE ${clauses.join(" AND ")}`;

	const countRow = await db
		.prepare(`SELECT COUNT(*) AS total FROM product_reviews r ${where}`)
		.bind(...params)
		.first<{ total: number }>();

	const { results } = await db
		.prepare(
			`SELECT r.id, r.product_id, r.author_name, r.rating, r.content, r.is_visible,
			        r.created_at, p.name AS product_name, p.slug AS product_slug,
			        o.order_code
			 FROM product_reviews r
			 LEFT JOIN products p ON p.id = r.product_id
			 LEFT JOIN orders o ON o.id = r.order_id
			 ${where}
			 ORDER BY r.created_at DESC, r.id DESC
			 LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
		)
		.bind(...params, perPage, (page - 1) * perPage)
		.all<AdminReview>();

	return { items: results ?? [], total: countRow?.total ?? 0, page, perPage };
}

export async function setReviewVisible(
	db: D1Database,
	reviewId: number,
	visible: boolean,
): Promise<void> {
	await db
		.prepare(`UPDATE product_reviews SET is_visible = ?2 WHERE id = ?1`)
		.bind(reviewId, visible ? 1 : 0)
		.run();
}

export async function deleteReview(db: D1Database, reviewId: number): Promise<void> {
	await db.prepare(`DELETE FROM product_reviews WHERE id = ?1`).bind(reviewId).run();
}

/** Số đánh giá đang ẩn — hiện thành chấm đỏ ở thanh điều hướng admin */
export async function countHiddenReviews(db: D1Database): Promise<number> {
	const row = await db
		.prepare(`SELECT COUNT(*) AS total FROM product_reviews WHERE is_visible = 0`)
		.first<{ total: number }>();
	return row?.total ?? 0;
}
