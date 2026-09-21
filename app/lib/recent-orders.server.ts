/**
 * Ghi nhớ các mã đơn mà trình duyệt này vừa đặt hoặc vừa tra cứu thành công.
 *
 * Lý do: trang /don-hang/:ma chứa tên, số điện thoại và địa chỉ khách. Mã đơn
 * chỉ có 5 chữ số nên hoàn toàn có thể dò được. Vì vậy trang chi tiết chỉ mở
 * khi mã nằm trong cookie này — tức là người xem hoặc vừa đặt đơn, hoặc đã
 * nhập đúng số điện thoại ở trang tra cứu.
 */

import { createCookie } from "react-router";

const MAX_CODES = 20;

export const recentOrdersCookie = createCookie("lumi_orders", {
	httpOnly: true,
	sameSite: "lax",
	path: "/",
	// http://localhost không phải HTTPS — bật Secure ở dev sẽ khiến trình
	// duyệt lặng lẽ bỏ qua cookie, đăng nhập và giỏ hàng đều không hoạt động.
	secure: import.meta.env.PROD,
	maxAge: 60 * 60 * 24 * 90, // 90 ngày
});

export async function readRecentOrders(request: Request): Promise<string[]> {
	const header = request.headers.get("Cookie");
	if (!header) return [];
	const raw = await recentOrdersCookie.parse(header);
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((value): value is string => typeof value === "string" && /^[A-Z0-9]{4,16}$/.test(value))
		.slice(0, MAX_CODES);
}

export async function rememberOrder(request: Request, code: string): Promise<string> {
	const existing = await readRecentOrders(request);
	const next = [code, ...existing.filter((value) => value !== code)].slice(0, MAX_CODES);
	return recentOrdersCookie.serialize(next);
}

export async function canViewOrder(request: Request, code: string): Promise<boolean> {
	return (await readRecentOrders(request)).includes(code);
}
