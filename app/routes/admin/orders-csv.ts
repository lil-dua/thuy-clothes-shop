import type { Route } from "./+types/orders-csv";
import { listOrders } from "~/lib/db.server";
import { formatDateTime } from "~/lib/format";
import {
	ORDER_STATUS_LABEL,
	PAYMENT_METHOD_LABEL,
	PAYMENT_STATUS_LABEL,
	type OrderStatus,
	type PaymentMethod,
	type PaymentStatus,
} from "~/lib/types";

/**
 * Xuất đơn hàng ra CSV để đối soát bằng Excel hoặc Google Sheets.
 *
 * Giữ nguyên bộ lọc đang xem ở trang danh sách, nên "xuất đơn tháng này, đã
 * giao" chỉ là lọc rồi bấm xuất.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.cloudflare.env.DB;
	const url = new URL(request.url);

	const { items } = await listOrders(db, {
		search: url.searchParams.get("q")?.trim() || null,
		orderStatus: url.searchParams.get("trang-thai") || null,
		paymentStatus: url.searchParams.get("thanh-toan") || null,
		page: 1,
		// Đủ cho một shop nhỏ trong nhiều năm; giới hạn để một cú bấm nhầm
		// không kéo cả database vào bộ nhớ Worker.
		perPage: 5000,
	});

	// Lấy chi tiết từng đơn để gộp danh sách sản phẩm vào một cột
	const ids = items.map((order) => order.id);
	const lines = new Map<number, string[]>();
	if (ids.length > 0) {
		const holes = ids.map((_, index) => `?${index + 1}`).join(", ");
		const { results } = await db
			.prepare(
				`SELECT order_id, product_name, size, color, quantity
				 FROM order_items WHERE order_id IN (${holes}) ORDER BY id`,
			)
			.bind(...ids)
			.all<{
				order_id: number;
				product_name: string;
				size: string;
				color: string | null;
				quantity: number;
			}>();

		for (const row of results ?? []) {
			const label = `${row.product_name} (${row.size}${row.color ? `/${row.color}` : ""}) x${row.quantity}`;
			lines.set(row.order_id, [...(lines.get(row.order_id) ?? []), label]);
		}
	}

	const header = [
		"Mã đơn",
		"Thời gian",
		"Khách hàng",
		"Điện thoại",
		"Email",
		"Địa chỉ",
		"Sản phẩm",
		"Phương thức",
		"Thanh toán",
		"Trạng thái",
		"Tạm tính",
		"Giảm giá",
		"Mã giảm giá",
		"Phí ship",
		"Tổng cộng",
		"Ghi chú",
	];

	const rows = items.map((order) => [
		order.order_code,
		formatDateTime(order.created_at),
		order.customer_name,
		// Dấu nháy đầu để Excel không cắt số 0 đứng đầu số điện thoại
		`'${order.customer_phone}`,
		order.customer_email ?? "",
		order.customer_address,
		(lines.get(order.id) ?? []).join(" | "),
		PAYMENT_METHOD_LABEL[order.payment_method as PaymentMethod],
		PAYMENT_STATUS_LABEL[order.payment_status as PaymentStatus],
		ORDER_STATUS_LABEL[order.order_status as OrderStatus],
		String(order.subtotal),
		String(order.discount_amount),
		order.discount_code ?? "",
		String(order.shipping_fee),
		String(order.total),
		order.note ?? "",
	]);

	// BOM UTF-8 ở đầu tệp, nếu không Excel trên Windows đọc tiếng Việt thành
	// ký tự loạn.
	const csv =
		"﻿" + [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");

	const stamp = new Date().toISOString().slice(0, 10);
	return new Response(csv, {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="don-hang-${stamp}.csv"`,
		},
	});
}

function escapeCell(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}
