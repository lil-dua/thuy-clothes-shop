import { redirect } from "react-router";
import type { Route } from "./+types/api.cart";
import {
	addLine,
	readCart,
	removeLine,
	serializeCart,
	setLineQuantity,
} from "~/lib/cart.server";
import { checkRateLimitSoft, clientIp } from "~/lib/rate-limit.server";

/**
 * Điểm vào duy nhất cho mọi thao tác giỏ hàng, để nút "Thêm vào giỏ" ở trang
 * chủ, trang danh sách và trang chi tiết dùng chung một đường.
 *
 * Luôn trả về redirect kèm Set-Cookie: form hoạt động cả khi JavaScript chưa
 * tải xong (progressive enhancement) — quan trọng với mạng 3G/4G trên điện thoại.
 */
export async function action({ request, context }: Route.ActionArgs) {
	// Ưu tiên thấp hơn login/checkout, nhưng vẫn giới hạn để một script không
	// ghi cookie giỏ hàng liên tục: 60 lần thao tác / phút cho mỗi IP là quá
	// đủ cho thao tác tay thật. Fail-open nếu D1 lỗi — giỏ hàng là luồng mua
	// hàng thật, không được sập vì tính năng chống spam.
	const rate = await checkRateLimitSoft(
		context.cloudflare.env.DB,
		{ scope: "cart-write", limit: 60, windowSeconds: 60 },
		clientIp(request),
	);
	if (!rate.allowed) {
		return new Response("Thao tác quá nhanh, vui lòng thử lại sau ít phút.", {
			status: 429,
			headers: { "Retry-After": String(rate.retryAfterSeconds) },
		});
	}

	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const variantId = Number.parseInt(String(form.get("variantId") ?? ""), 10);
	const quantity = Number.parseInt(String(form.get("quantity") ?? "1"), 10);
	const redirectTo = sanitizeRedirect(String(form.get("redirectTo") ?? "/gio-hang"));

	let lines = await readCart(request);

	switch (intent) {
		case "add":
			if (Number.isInteger(variantId) && variantId > 0) {
				lines = addLine(lines, variantId, Number.isFinite(quantity) ? quantity : 1);
			}
			break;
		case "update":
			if (Number.isInteger(variantId) && variantId > 0) {
				lines = setLineQuantity(lines, variantId, Number.isFinite(quantity) ? quantity : 0);
			}
			break;
		case "remove":
			if (Number.isInteger(variantId) && variantId > 0) {
				lines = removeLine(lines, variantId);
			}
			break;
		case "clear":
			lines = [];
			break;
	}

	return redirect(redirectTo, {
		headers: { "Set-Cookie": await serializeCart(lines) },
	});
}

/**
 * Chỉ cho phép quay lại đường dẫn nội bộ — chặn open redirect.
 *
 * `//evil.com` bị chặn vì trình duyệt hiểu là URL protocol-relative (giữ
 * nguyên scheme, đổi host). Ít rõ hơn: `/\evil.com` cũng phải chặn — nhiều
 * trình duyệt (Chrome, Firefox) tự chuẩn hoá `\` thành `/` khi phân tích
 * Location header, nên giá trị này biến thành `//evil.com` sau khi chuẩn
 * hoá dù chuỗi gốc không bắt đầu bằng hai dấu `/`.
 */
function sanitizeRedirect(value: string): string {
	if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
		return "/gio-hang";
	}
	return value;
}

/** Truy cập trực tiếp bằng GET thì đưa về giỏ hàng */
export function loader() {
	return redirect("/gio-hang");
}
