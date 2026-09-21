/**
 * Giỏ hàng lưu trong cookie — khách mua được mà không cần đăng nhập.
 *
 * Cookie chỉ giữ `{variantId, quantity}`. Tên, giá, tồn kho luôn đọc lại từ D1
 * khi render: giá hiển thị và giá tính tiền không bao giờ lấy từ phía client.
 */

import { createCookie } from "react-router";
import type { CartLine, CartLineDetail } from "./types";

const CART_COOKIE_NAME = "lumi_cart";
const MAX_LINES = 50;
const MAX_QTY_PER_LINE = 99;

export const cartCookie = createCookie(CART_COOKIE_NAME, {
	httpOnly: true,
	sameSite: "lax",
	path: "/",
	// http://localhost không phải HTTPS — bật Secure ở dev sẽ khiến trình
	// duyệt lặng lẽ bỏ qua cookie, đăng nhập và giỏ hàng đều không hoạt động.
	secure: import.meta.env.PROD,
	maxAge: 60 * 60 * 24 * 30, // 30 ngày
});

export async function readCart(request: Request): Promise<CartLine[]> {
	const header = request.headers.get("Cookie");
	if (!header) return [];
	const raw = await cartCookie.parse(header);
	return sanitize(raw);
}

export async function serializeCart(lines: CartLine[]): Promise<string> {
	return cartCookie.serialize(sanitize(lines));
}

/** Loại bỏ dữ liệu hỏng/bịa từ cookie trước khi dùng */
function sanitize(raw: unknown): CartLine[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<number>();
	const lines: CartLine[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const variantId = Number((entry as CartLine).variantId);
		const quantity = Number((entry as CartLine).quantity);
		if (!Number.isInteger(variantId) || variantId <= 0) continue;
		if (!Number.isInteger(quantity) || quantity <= 0) continue;
		if (seen.has(variantId)) continue;
		seen.add(variantId);
		lines.push({ variantId, quantity: Math.min(quantity, MAX_QTY_PER_LINE) });
		if (lines.length >= MAX_LINES) break;
	}
	return lines;
}

export function addLine(lines: CartLine[], variantId: number, quantity: number): CartLine[] {
	const next = [...lines];
	const existing = next.find((line) => line.variantId === variantId);
	if (existing) {
		existing.quantity = Math.min(existing.quantity + quantity, MAX_QTY_PER_LINE);
	} else {
		next.push({ variantId, quantity: Math.min(quantity, MAX_QTY_PER_LINE) });
	}
	return next.slice(0, MAX_LINES);
}

export function setLineQuantity(
	lines: CartLine[],
	variantId: number,
	quantity: number,
): CartLine[] {
	if (quantity <= 0) return removeLine(lines, variantId);
	return lines.map((line) =>
		line.variantId === variantId
			? { ...line, quantity: Math.min(quantity, MAX_QTY_PER_LINE) }
			: line,
	);
}

export function removeLine(lines: CartLine[], variantId: number): CartLine[] {
	return lines.filter((line) => line.variantId !== variantId);
}

/**
 * Nạp thông tin đầy đủ cho từng dòng giỏ hàng từ D1.
 * Dòng trỏ tới biến thể đã bị xoá / sản phẩm ngừng bán sẽ bị loại bỏ,
 * và `removed` báo cho route biết cần ghi lại cookie.
 */
export async function loadCartDetails(
	db: D1Database,
	lines: CartLine[],
): Promise<{ items: CartLineDetail[]; removed: boolean }> {
	if (lines.length === 0) return { items: [], removed: false };

	const ids = lines.map((line) => line.variantId);
	const holes = ids.map((_, index) => `?${index + 1}`).join(", ");

	const { results } = await db
		.prepare(
			`SELECT v.id AS variant_id, v.size, v.color, v.quantity AS available,
			        p.id AS product_id, p.slug AS product_slug, p.name AS product_name,
			        p.sale_price, p.cost_price, p.status,
			        (SELECT r2_key FROM product_images
			          WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_key
			 FROM product_variants v
			 JOIN products p ON p.id = v.product_id
			 WHERE v.id IN (${holes}) AND v.is_active = 1 AND p.status = 'active'`,
		)
		.bind(...ids)
		.all<{
			variant_id: number;
			size: string;
			color: string | null;
			available: number;
			product_id: number;
			product_slug: string;
			product_name: string;
			sale_price: number;
			cost_price: number;
			image_key: string | null;
		}>();

	const byId = new Map((results ?? []).map((row) => [row.variant_id, row]));

	const items: CartLineDetail[] = [];
	let removed = false;

	for (const line of lines) {
		const row = byId.get(line.variantId);
		if (!row) {
			removed = true; // biến thể không còn bán
			continue;
		}
		items.push({
			variantId: row.variant_id,
			quantity: line.quantity,
			productId: row.product_id,
			productSlug: row.product_slug,
			productName: row.product_name,
			imageKey: row.image_key,
			size: row.size,
			color: row.color,
			unitPrice: row.sale_price,
			unitCost: row.cost_price,
			lineTotal: row.sale_price * line.quantity,
			available: row.available,
		});
	}

	return { items, removed };
}

// ---------------------------------------------------------------------------
// Mã giảm giá đang áp dụng — giữ trong cookie riêng để khách chuyển từ giỏ
// sang trang thanh toán mà không phải nhập lại.
// ---------------------------------------------------------------------------

export const discountCookie = createCookie("lumi_discount", {
	httpOnly: true,
	sameSite: "lax",
	path: "/",
	secure: import.meta.env.PROD,
	maxAge: 60 * 60 * 24, // 1 ngày
});

export async function readDiscountCode(request: Request): Promise<string | null> {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	const value = await discountCookie.parse(header);
	return typeof value === "string" && value.length > 0 && value.length <= 40 ? value : null;
}

export function serializeDiscountCode(code: string | null): Promise<string> {
	return code
		? discountCookie.serialize(code)
		: discountCookie.serialize("", { maxAge: 0 });
}

export function cartCount(lines: CartLine[]): number {
	return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartSubtotal(items: CartLineDetail[]): number {
	return items.reduce((sum, item) => sum + item.lineTotal, 0);
}
