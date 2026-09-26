/**
 * Báo đơn mới ra các kênh đã cấu hình.
 *
 * Hai chiều, hai kênh khác nhau vì điều kiện thực tế khác nhau:
 *   • Khách  → email (Resend). Kênh tự động duy nhất miễn phí; SMS và Zalo ZNS
 *              đều tính phí theo tin và đòi giấy phép kinh doanh.
 *   • Chủ shop → Telegram. Miễn phí hoàn toàn, tin tới trong vài giây.
 *
 * Nguyên tắc xuyên suốt: đơn đã nằm trong database rồi, nên KHÔNG có lỗi thông
 * báo nào được phép nổi lên thành lỗi cho khách. Mọi kết quả — gửi được, hỏng,
 * hay bỏ qua vì chưa cấu hình — đều ghi vào notification_log kèm lý do.
 */

import { sendOrderEmails } from "./email.server";
import { getSecret, type ShopSettings } from "./settings.server";
import { renderOrderMessage, sendTelegramMessage } from "./telegram.server";
import type { OrderWithItems } from "./types";

export type NotifyChannel = "email" | "telegram";
export type NotifyAudience = "customer" | "owner";

export async function logNotification(
	db: D1Database,
	entry: {
		orderId: number;
		channel: NotifyChannel;
		audience: NotifyAudience;
		recipient: string;
		status: "sent" | "failed" | "skipped";
		error?: string | null;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO notification_log (order_id, channel, audience, recipient, status, error)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
		)
		.bind(
			entry.orderId,
			entry.channel,
			entry.audience,
			entry.recipient || "—",
			entry.status,
			entry.error ?? null,
		)
		.run()
		// Ghi log hỏng cũng không được làm đổ việc gửi thông báo
		.catch(() => undefined);
}

/**
 * Gọi một lần sau khi tạo đơn thành công. Nên bọc trong ctx.waitUntil để khách
 * không phải chờ các API bên ngoài trả lời mới thấy trang cảm ơn.
 */
export async function notifyNewOrder(
	db: D1Database,
	env: Record<string, unknown>,
	settings: ShopSettings,
	order: OrderWithItems,
	shopUrl: string,
): Promise<void> {
	const [resendKey, telegramToken] = await Promise.all([
		getSecret(db, "resend_api_key", env),
		getSecret(db, "telegram_bot_token", env),
	]);

	await Promise.allSettled([
		sendOrderEmails(db, resendKey, settings, order, shopUrl),
		notifyTelegram(db, telegramToken, settings, order, shopUrl),
	]);
}

async function notifyTelegram(
	db: D1Database,
	token: string | null,
	settings: ShopSettings,
	order: OrderWithItems,
	shopUrl: string,
): Promise<void> {
	const chatId = settings.telegram_chat_id.trim();

	if (!token || !chatId) {
		await logNotification(db, {
			orderId: order.id,
			channel: "telegram",
			audience: "owner",
			recipient: chatId,
			status: "skipped",
			error: "Chưa cấu hình Telegram",
		});
		return;
	}

	try {
		const result = await sendTelegramMessage(
			token,
			chatId,
			renderOrderMessage(order, settings, shopUrl),
		);
		await logNotification(db, {
			orderId: order.id,
			channel: "telegram",
			audience: "owner",
			recipient: chatId,
			status: result.ok ? "sent" : "failed",
			error: result.ok ? null : result.error,
		});
	} catch (error) {
		await logNotification(db, {
			orderId: order.id,
			channel: "telegram",
			audience: "owner",
			recipient: chatId,
			status: "failed",
			error: String(error),
		});
	}
}
