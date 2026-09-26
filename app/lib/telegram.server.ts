/**
 * Báo đơn mới cho chủ shop qua Telegram.
 *
 * Vì sao Telegram mà không phải SMS hay Zalo ZNS: hai kênh kia đều tính phí
 * theo tin và đều đòi giấy phép kinh doanh (SMS brandname ~900k phí cấp tên +
 * 50k/tháng mỗi nhà mạng; ZNS ~210–300đ/tin, cần OA xác thực doanh nghiệp).
 * Telegram Bot API miễn phí hoàn toàn, không cần đăng ký gì, tin tới trong vài
 * giây — vừa đủ cho việc chủ shop biết có đơn mới.
 *
 * Kênh này CHỈ dành cho chủ shop. Khách hàng vẫn nhận xác nhận qua email.
 */

import { formatVnd } from "./format";
import type { ShopSettings } from "./settings.server";
import { PAYMENT_METHOD_LABEL, type OrderWithItems } from "./types";

const API = "https://api.telegram.org";

export type TelegramResult = { ok: true } | { ok: false; error: string };

async function call<T>(
	token: string,
	method: string,
	body?: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
	let response: Response;
	try {
		response = await fetch(`${API}/bot${token}/${method}`, {
			method: body ? "POST" : "GET",
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
	} catch (error) {
		return { ok: false, error: `Không kết nối được Telegram: ${String(error)}` };
	}

	// Telegram luôn trả JSON kèm `description` khi lỗi, kể cả với mã 4xx
	const payload = (await response.json().catch(() => null)) as
		| { ok: boolean; result?: T; description?: string }
		| null;

	if (!payload) return { ok: false, error: `Telegram trả lỗi ${response.status}` };
	if (!payload.ok) {
		const description = payload.description ?? `lỗi ${response.status}`;
		if (description.includes("chat not found")) {
			return {
				ok: false,
				error: "Không tìm thấy cuộc trò chuyện — bạn cần nhắn cho bot một câu trước",
			};
		}
		if (description.includes("Unauthorized")) {
			return { ok: false, error: "Token bot không hợp lệ" };
		}
		return { ok: false, error: `Telegram: ${description}` };
	}

	return { ok: true, data: payload.result as T };
}

/** Telegram chỉ cho vài thẻ HTML, nên phải thoát ký tự trong nội dung người dùng */
function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegramMessage(
	token: string,
	chatId: string,
	text: string,
): Promise<TelegramResult> {
	const result = await call(token, "sendMessage", {
		chat_id: chatId,
		text,
		parse_mode: "HTML",
		link_preview_options: { is_disabled: true },
	});
	return result.ok ? { ok: true } : result;
}

// ---------------------------------------------------------------------------
// Tìm Chat ID
// ---------------------------------------------------------------------------

export interface TelegramChat {
	id: string;
	name: string;
}

interface TelegramApiChat {
	id: number;
	type: string;
	title?: string;
	first_name?: string;
	username?: string;
}

interface Update {
	message?: { chat?: TelegramApiChat };
	channel_post?: { chat?: TelegramApiChat };
}

/**
 * Liệt kê các cuộc trò chuyện vừa nhắn cho bot.
 *
 * Chat ID là thứ khó tìm nhất khi dựng bot Telegram — nó không hiện ở đâu trong
 * giao diện. Cách duy nhất là nhắn cho bot một câu rồi đọc getUpdates, nên chỗ
 * này làm hộ luôn để chủ shop chỉ việc bấm chọn.
 */
export async function listTelegramChats(
	token: string,
): Promise<{ ok: true; chats: TelegramChat[] } | { ok: false; error: string }> {
	const result = await call<Update[]>(token, "getUpdates");
	if (!result.ok) return result;

	const seen = new Map<string, string>();
	for (const update of result.data ?? []) {
		const chat = update.message?.chat ?? update.channel_post?.chat;
		if (!chat) continue;
		const name =
			chat.title ??
			[chat.first_name, chat.username && `@${chat.username}`].filter(Boolean).join(" ") ??
			chat.type;
		seen.set(String(chat.id), name || chat.type);
	}

	return { ok: true, chats: [...seen].map(([id, name]) => ({ id, name })) };
}

// ---------------------------------------------------------------------------
// Nội dung tin báo đơn
// ---------------------------------------------------------------------------

export function renderOrderMessage(
	order: OrderWithItems,
	settings: ShopSettings,
	shopUrl: string,
): string {
	const items = order.items
		.map(
			(item) =>
				`• ${escapeHtml(item.product_name)} — ${escapeHtml(item.size)}${
					item.color ? `/${escapeHtml(item.color)}` : ""
				} ×${item.quantity} — ${formatVnd(item.line_total)}`,
		)
		.join("\n");

	const discount =
		order.discount_amount > 0
			? `\nGiảm giá (${escapeHtml(order.discount_code ?? "")}): -${formatVnd(order.discount_amount)}`
			: "";

	// Đơn trả trước cần nhắc riêng: hàng đang bị giữ chỗ và sẽ tự huỷ nếu
	// khách không chuyển tiền đúng hạn.
	const waiting =
		order.payment_method !== "cod"
			? "\n\n⏳ <i>Chờ khách chuyển khoản. Nhận được tiền thì bấm “Xác nhận đã nhận tiền”.</i>"
			: "";

	return `🛍 <b>Đơn mới ${order.order_code}</b>
${formatVnd(order.total)} · ${escapeHtml(PAYMENT_METHOD_LABEL[order.payment_method])}

<b>${escapeHtml(order.customer_name)}</b> · ${escapeHtml(order.customer_phone)}
${escapeHtml(order.customer_address)}${
		order.note ? `\n📝 ${escapeHtml(order.note)}` : ""
	}

${items}

Tạm tính: ${formatVnd(order.subtotal)}${discount}
Phí ship: ${order.shipping_fee === 0 ? "Miễn phí" : formatVnd(order.shipping_fee)}${waiting}

<a href="${shopUrl}/admin/don-hang">Mở trang quản trị</a>`;
}

export function renderTestMessage(settings: ShopSettings): string {
	return `✅ <b>${escapeHtml(settings.shop_name)}</b> đã kết nối Telegram.

Từ giờ mỗi đơn mới sẽ báo về đây kèm tên khách, số điện thoại, địa chỉ và danh sách sản phẩm.`;
}
