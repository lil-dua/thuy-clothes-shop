import { redirect } from "react-router";
import type { Route } from "./+types/api.cart";
import {
	addLine,
	readCart,
	removeLine,
	serializeCart,
	setLineQuantity,
} from "~/lib/cart.server";

/**
 * Điểm vào duy nhất cho mọi thao tác giỏ hàng, để nút "Thêm vào giỏ" ở trang
 * chủ, trang danh sách và trang chi tiết dùng chung một đường.
 *
 * Luôn trả về redirect kèm Set-Cookie: form hoạt động cả khi JavaScript chưa
 * tải xong (progressive enhancement) — quan trọng với mạng 3G/4G trên điện thoại.
 */
export async function action({ request }: Route.ActionArgs) {
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

/** Chỉ cho phép quay lại đường dẫn nội bộ — chặn open redirect */
function sanitizeRedirect(value: string): string {
	if (!value.startsWith("/") || value.startsWith("//")) return "/gio-hang";
	return value;
}

/** Truy cập trực tiếp bằng GET thì đưa về giỏ hàng */
export function loader() {
	return redirect("/gio-hang");
}
