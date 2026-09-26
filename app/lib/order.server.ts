/**
 * Tạo đơn, kiểm mã giảm giá, và giải phóng tồn kho của đơn quá hạn giữ chỗ.
 *
 * Nguyên tắc: mọi con số tiền đều tính lại ở server từ dữ liệu trong D1.
 * Giá, phí ship, giảm giá gửi lên từ trình duyệt đều bị bỏ qua.
 */

import { sqlNow } from "./format";
import type { ShopSettings } from "./settings.server";
import { shippingFeeFor } from "./settings.server";
import type { CartLineDetail, DiscountCode, OrderStatus, PaymentMethod } from "./types";
import { ORDER_STATUS_FLOW } from "./types";

export interface CreateOrderInput {
	items: CartLineDetail[];
	customerName: string;
	customerPhone: string;
	customerEmail?: string | null;
	customerAddress: string;
	paymentMethod: PaymentMethod;
	note?: string | null;
	discountCode?: string | null;
}

export type CreateOrderResult =
	| { ok: true; orderCode: string }
	| { ok: false; error: string };

export async function createOrder(
	db: D1Database,
	settings: ShopSettings,
	input: CreateOrderInput,
): Promise<CreateOrderResult> {
	if (input.items.length === 0) {
		return { ok: false, error: "Giỏ hàng đang trống" };
	}

	// Kiểm tồn kho trước để báo lỗi cụ thể cho khách. Ràng buộc
	// CHECK (quantity >= 0) trong schema vẫn là chốt chặn cuối khi có
	// hai khách cùng đặt size cuối cùng tại cùng thời điểm.
	const outOfStock = input.items.find((item) => item.quantity > item.available);
	if (outOfStock) {
		return {
			ok: false,
			error:
				outOfStock.available === 0
					? `"${outOfStock.productName}" size ${outOfStock.size} đã hết hàng`
					: `"${outOfStock.productName}" size ${outOfStock.size} chỉ còn ${outOfStock.available} sản phẩm`,
		};
	}

	const subtotal = input.items.reduce((sum, item) => sum + item.lineTotal, 0);

	let discountAmount = 0;
	let discountCode: string | null = null;
	if (input.discountCode) {
		const check = await validateDiscountCode(db, input.discountCode, subtotal);
		if (!check.ok) return { ok: false, error: check.error };
		discountAmount = check.amount;
		discountCode = check.code.code;
	}

	const shippingFee = shippingFeeFor(settings, subtotal);
	const total = Math.max(0, subtotal - discountAmount + shippingFee);

	const orderCode = await generateOrderCode(db);

	// Chỉ đơn chờ chuyển khoản mới cần hạn giữ chỗ; COD xác nhận trực tiếp.
	const holdMinutes = Number.parseInt(settings.order_hold_minutes, 10) || 30;
	const reservedUntil =
		input.paymentMethod === "cod" ? null : sqlNow(holdMinutes * 60 * 1000);

	const statements: D1PreparedStatement[] = [];

	// 1. Khách hàng — nhận diện theo số điện thoại, không bắt đăng ký
	statements.push(
		db
			.prepare(
				`INSERT INTO customers (name, phone, address, email) VALUES (?1, ?2, ?3, ?4)
				 ON CONFLICT(phone) DO UPDATE SET
				   name = excluded.name,
				   address = excluded.address,
				   -- Giữ email cũ nếu lần này khách không nhập
				   email = COALESCE(excluded.email, customers.email)`,
			)
			.bind(
				input.customerName,
				input.customerPhone,
				input.customerAddress,
				input.customerEmail ?? null,
			),
	);

	// 2. Đơn hàng
	statements.push(
		db
			.prepare(
				`INSERT INTO orders (
				   order_code, customer_id, customer_name, customer_phone, customer_address,
				   payment_method, subtotal, shipping_fee, discount_code, discount_amount,
				   total, note, reserved_until, customer_email
				 ) VALUES (
				   ?1, (SELECT id FROM customers WHERE phone = ?3), ?2, ?3, ?4,
				   ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
				 )`,
			)
			.bind(
				orderCode,
				input.customerName,
				input.customerPhone,
				input.customerAddress,
				input.paymentMethod,
				subtotal,
				shippingFee,
				discountCode,
				discountAmount,
				total,
				input.note ?? null,
				reservedUntil,
				input.customerEmail ?? null,
			),
	);

	// 3. Chi tiết đơn + trừ kho + đếm lượt bán
	for (const item of input.items) {
		statements.push(
			db
				.prepare(
					`INSERT INTO order_items (
					   order_id, product_variant_id, product_id, product_name, product_slug,
					   image_r2_key, size, color, unit_price, unit_cost, quantity, line_total
					 ) VALUES (
					   (SELECT id FROM orders WHERE order_code = ?1),
					   ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
					 )`,
				)
				.bind(
					orderCode,
					item.variantId,
					item.productId,
					item.productName,
					item.productSlug,
					item.imageKey,
					item.size,
					item.color,
					item.unitPrice,
					item.unitCost,
					item.quantity,
					item.lineTotal,
				),
		);
		statements.push(
			db
				.prepare(`UPDATE product_variants SET quantity = quantity - ?2 WHERE id = ?1`)
				.bind(item.variantId, item.quantity),
		);
		statements.push(
			db
				.prepare(`UPDATE products SET sold_count = sold_count + ?2 WHERE id = ?1`)
				.bind(item.productId, item.quantity),
		);
	}

	// 4. Cập nhật tổng chi tiêu của khách + lượt dùng mã giảm giá
	statements.push(
		db
			.prepare(
				`UPDATE customers SET order_count = order_count + 1, total_spent = total_spent + ?2
				 WHERE phone = ?1`,
			)
			.bind(input.customerPhone, total),
	);
	if (discountCode) {
		statements.push(
			db
				.prepare(`UPDATE discount_codes SET used_count = used_count + 1 WHERE code = ?1`)
				.bind(discountCode),
		);
	}

	try {
		// D1 batch chạy trong một transaction: hoặc tất cả thành công, hoặc
		// không có gì được ghi — không thể có đơn tạo ra mà kho chưa trừ.
		await db.batch(statements);
	} catch (error) {
		const message = String(error);
		if (message.includes("CHECK constraint failed")) {
			return {
				ok: false,
				error: "Rất tiếc, một sản phẩm vừa được khách khác đặt hết. Vui lòng kiểm tra lại giỏ hàng.",
			};
		}
		throw error;
	}

	return { ok: true, orderCode };
}

/** Sinh mã đơn dạng LUMI12345, thử lại nếu trùng */
async function generateOrderCode(db: D1Database): Promise<string> {
	for (let attempt = 0; attempt < 10; attempt++) {
		const number = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000;
		const code = `LUMI${number.toString().padStart(5, "0")}`;
		const existing = await db
			.prepare(`SELECT 1 AS hit FROM orders WHERE order_code = ?1`)
			.bind(code)
			.first();
		if (!existing) return code;
	}
	return `LUMI${Date.now().toString().slice(-8)}`;
}

// ---------------------------------------------------------------------------
// Mã giảm giá
// ---------------------------------------------------------------------------

export type DiscountCheck =
	| { ok: true; code: DiscountCode; amount: number }
	| { ok: false; error: string };

export async function validateDiscountCode(
	db: D1Database,
	rawCode: string,
	subtotal: number,
): Promise<DiscountCheck> {
	const code = rawCode.trim().toUpperCase();
	if (!code) return { ok: false, error: "Vui lòng nhập mã giảm giá" };

	const row = await db
		.prepare(`SELECT * FROM discount_codes WHERE code = ?1 COLLATE NOCASE`)
		.bind(code)
		.first<DiscountCode>();

	if (!row || !row.is_active) return { ok: false, error: "Mã giảm giá không tồn tại" };

	const now = sqlNow();
	if (row.starts_at && row.starts_at > now) {
		return { ok: false, error: "Mã giảm giá chưa đến thời gian áp dụng" };
	}
	if (row.ends_at && row.ends_at < now) {
		return { ok: false, error: "Mã giảm giá đã hết hạn" };
	}
	if (row.usage_limit != null && row.used_count >= row.usage_limit) {
		return { ok: false, error: "Mã giảm giá đã hết lượt sử dụng" };
	}
	if (subtotal < row.min_order) {
		return {
			ok: false,
			error: `Đơn hàng cần tối thiểu ${row.min_order.toLocaleString("vi-VN")}đ để dùng mã này`,
		};
	}

	let amount =
		row.discount_type === "percent"
			? Math.floor((subtotal * row.discount_value) / 100)
			: row.discount_value;
	if (row.max_discount != null) amount = Math.min(amount, row.max_discount);
	amount = Math.min(amount, subtotal);

	return { ok: true, code: row, amount };
}

// ---------------------------------------------------------------------------
// Giải phóng tồn kho của đơn quá hạn giữ chỗ
// ---------------------------------------------------------------------------

/**
 * Huỷ các đơn chuyển khoản/MoMo chưa thanh toán đã quá `reserved_until`
 * và hoàn lại tồn kho. Gọi trước các thao tác đọc tồn kho quan trọng
 * (trang sản phẩm, giỏ hàng, checkout, danh sách đơn ở admin).
 */
export async function releaseExpiredOrders(db: D1Database): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT id FROM orders
			 WHERE order_status = 'pending'
			   AND payment_status = 'pending'
			   AND payment_method IN ('bank_transfer', 'momo')
			   AND reserved_until IS NOT NULL
			   AND reserved_until < datetime('now')
			 LIMIT 50`,
		)
		.all<{ id: number }>();

	const expired = results ?? [];
	if (expired.length === 0) return 0;

	const statements: D1PreparedStatement[] = [];
	for (const { id } of expired) {
		statements.push(...restoreStockStatements(db, id));
		statements.push(
			db
				.prepare(
					`UPDATE orders
					 SET order_status = 'cancelled',
					     admin_note = COALESCE(admin_note || ' | ', '') || 'Tự huỷ: quá hạn thanh toán',
					     updated_at = datetime('now')
					 WHERE id = ?1`,
				)
				.bind(id),
		);
	}
	await db.batch(statements);
	return expired.length;
}

/** Các câu lệnh hoàn kho, trừ lượt bán và trả lại lượt dùng mã cho đơn bị huỷ */
function restoreStockStatements(db: D1Database, orderId: number): D1PreparedStatement[] {
	return [
		db
			.prepare(
				`UPDATE product_variants
				 SET quantity = quantity + (
				   SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
				   WHERE oi.order_id = ?1 AND oi.product_variant_id = product_variants.id
				 )
				 WHERE id IN (SELECT product_variant_id FROM order_items WHERE order_id = ?1)`,
			)
			.bind(orderId),
		db
			.prepare(
				`UPDATE products
				 SET sold_count = MAX(0, sold_count - (
				   SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
				   WHERE oi.order_id = ?1 AND oi.product_id = products.id
				 ))
				 WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ?1)`,
			)
			.bind(orderId),
		// Trả lại lượt dùng mã giảm giá. Thiếu câu này thì mã giới hạn lượt sẽ bị
		// đốt dần bởi những đơn không bao giờ thành: đơn chuyển khoản bỏ dở tự huỷ
		// sau 30 phút vẫn giữ nguyên một lượt, tới lúc hết lượt thì khách thật
		// không dùng được mã nữa mà chủ shop không hiểu vì sao.
		db
			.prepare(
				`UPDATE discount_codes
				 SET used_count = MAX(0, used_count - 1)
				 WHERE code = (
				   SELECT discount_code FROM orders
				   WHERE id = ?1 AND discount_code IS NOT NULL
				 )`,
			)
			.bind(orderId),
	];
}

// ---------------------------------------------------------------------------
// Cập nhật trạng thái từ trang quản trị
// ---------------------------------------------------------------------------

export async function updateOrderStatus(
	db: D1Database,
	orderId: number,
	nextStatus: OrderStatus,
): Promise<{ ok: boolean; error?: string }> {
	const order = await db
		.prepare(
			`SELECT order_status, payment_method, payment_status FROM orders WHERE id = ?1`,
		)
		.bind(orderId)
		.first<{
			order_status: OrderStatus;
			payment_method: PaymentMethod;
			payment_status: string;
		}>();
	if (!order) return { ok: false, error: "Không tìm thấy đơn hàng" };

	if (!ORDER_STATUS_FLOW[order.order_status].includes(nextStatus)) {
		return { ok: false, error: "Không thể chuyển sang trạng thái này" };
	}

	// Đơn trả trước (chuyển khoản / MoMo) phải xác nhận đã nhận tiền rồi mới
	// được giao — nếu không, shop có thể lỡ tay gửi hàng mà chưa thu được đồng nào.
	const prepaid = order.payment_method !== "cod";
	const shipping = nextStatus === "shipping" || nextStatus === "delivered";
	if (prepaid && shipping && order.payment_status !== "paid") {
		return {
			ok: false,
			error: 'Đơn này thanh toán trước. Bấm "Xác nhận đã nhận tiền" rồi mới chuyển sang giao hàng.',
		};
	}

	const statements: D1PreparedStatement[] = [];

	if (nextStatus === "cancelled") {
		// Huỷ đơn thì phải hoàn kho, nếu không tồn kho sẽ hụt dần.
		statements.push(...restoreStockStatements(db, orderId));
	}

	// Giao thành công cho đơn COD = đã thu tiền.
	const markPaid = nextStatus === "delivered" && order.payment_method === "cod";
	statements.push(
		db
			.prepare(
				`UPDATE orders SET
				   order_status = ?2,
				   reserved_until = NULL,
				   payment_status = CASE WHEN ?3 = 1 THEN 'paid' ELSE payment_status END,
				   paid_at = CASE WHEN ?3 = 1 AND paid_at IS NULL THEN datetime('now') ELSE paid_at END,
				   updated_at = datetime('now')
				 WHERE id = ?1`,
			)
			.bind(orderId, nextStatus, markPaid ? 1 : 0),
	);

	await db.batch(statements);
	return { ok: true };
}

export async function markOrderPaid(
	db: D1Database,
	orderId: number,
): Promise<{ ok: boolean; error?: string }> {
	const result = await db
		.prepare(
			`UPDATE orders SET
			   payment_status = 'paid',
			   paid_at = datetime('now'),
			   reserved_until = NULL,
			   order_status = CASE WHEN order_status = 'pending' THEN 'confirmed' ELSE order_status END,
			   updated_at = datetime('now')
			 WHERE id = ?1 AND order_status != 'cancelled'`,
		)
		.bind(orderId)
		.run();

	if (!result.meta.changes) {
		return { ok: false, error: "Không thể xác nhận thanh toán cho đơn đã huỷ" };
	}
	return { ok: true };
}
