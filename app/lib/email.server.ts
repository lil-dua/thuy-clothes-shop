/**
 * Gửi email qua Resend.
 *
 * Vì sao Resend: MailChannels đã ngừng gói miễn phí cho Cloudflare Workers từ
 * 30/6/2024, và tài liệu Cloudflare nay trỏ thẳng sang Resend. Gói miễn phí
 * 3.000 email/tháng, gọi bằng HTTP nên chạy được trong Worker.
 *
 * Tính năng NGỦ YÊN khi chưa cấu hình: không có API key hoặc không có địa chỉ
 * gửi thì bỏ qua, ghi 'skipped' vào email_log, và tuyệt đối không làm hỏng việc
 * đặt hàng. Mất email còn đỡ hơn mất đơn.
 */

import { formatVnd } from "./format";
import type { ShopSettings } from "./settings.server";
import { vietQrImageUrl } from "./settings.server";
import { PAYMENT_METHOD_LABEL, type OrderWithItems } from "./types";

const API = "https://api.resend.com/emails";

type SendResult = { ok: true; id: string } | { ok: false; error: string };

async function sendEmail(
	apiKey: string,
	payload: { from: string; to: string; subject: string; html: string; replyTo?: string },
): Promise<SendResult> {
	let response: Response;
	try {
		response = await fetch(API, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: payload.from,
				to: [payload.to],
				subject: payload.subject,
				html: payload.html,
				...(payload.replyTo && { reply_to: payload.replyTo }),
			}),
		});
	} catch (error) {
		return { ok: false, error: `Không kết nối được Resend: ${String(error)}` };
	}

	const body = await response.text().catch(() => "");
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) {
			return { ok: false, error: "API key Resend không hợp lệ" };
		}
		// Lỗi hay gặp nhất: gửi từ domain chưa xác minh. Giữ nguyên câu của
		// Resend vì nó nói rõ domain nào đang thiếu.
		try {
			const parsed = JSON.parse(body) as { message?: string; name?: string };
			if (parsed.message) {
				return { ok: false, error: `Resend (${response.status}): ${parsed.message}` };
			}
		} catch {
			// không phải JSON thì dùng nguyên văn
		}
		return { ok: false, error: `Resend trả lỗi ${response.status}: ${body.slice(0, 200)}` };
	}

	try {
		return { ok: true, id: (JSON.parse(body) as { id: string }).id };
	} catch {
		return { ok: true, id: "" };
	}
}

// ---------------------------------------------------------------------------
// Nội dung email
// ---------------------------------------------------------------------------

const BRAND = "#ea5586";

/** Bảng sản phẩm dùng chung cho cả hai mẫu email */
function itemRows(order: OrderWithItems): string {
	return order.items
		.map(
			(item) => `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #eee">
    <div style="font-size:14px;color:#2e282d">${escapeHtml(item.product_name)}</div>
    <div style="font-size:12px;color:#7d7079">Size ${escapeHtml(item.size)}${
			item.color ? ` · ${escapeHtml(item.color)}` : ""
		} × ${item.quantity}</div>
  </td>
  <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-size:14px;white-space:nowrap">
    ${formatVnd(item.line_total)}
  </td>
</tr>`,
		)
		.join("");
}

function totalsRows(order: OrderWithItems): string {
	const row = (label: string, value: string, strong = false) =>
		`<tr>
  <td style="padding:4px 0;font-size:${strong ? 15 : 13}px;color:${strong ? "#2e282d" : "#7d7079"};${
		strong ? "font-weight:700" : ""
	}">${label}</td>
  <td style="padding:4px 0;text-align:right;font-size:${strong ? 17 : 13}px;color:${
		strong ? BRAND : "#2e282d"
	};${strong ? "font-weight:700" : ""}">${value}</td>
</tr>`;

	return [
		row("Tạm tính", formatVnd(order.subtotal)),
		order.discount_amount > 0
			? row(`Giảm giá (${escapeHtml(order.discount_code ?? "")})`, `-${formatVnd(order.discount_amount)}`)
			: "",
		row("Phí vận chuyển", order.shipping_fee === 0 ? "Miễn phí" : formatVnd(order.shipping_fee)),
		row("Tổng cộng", formatVnd(order.total), true),
	].join("");
}

function shell(title: string, inner: string, footer: string): string {
	return `<!doctype html>
<html lang="vi"><body style="margin:0;padding:24px 12px;background:#faf8f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
  <tr><td>
    <h1 style="margin:0 0 4px;font-size:20px;color:#1e1a1e">${title}</h1>
    ${inner}
    <p style="margin:24px 0 0;font-size:12px;color:#a99aa3;border-top:1px solid #eee;padding-top:16px">${footer}</p>
  </td></tr>
</table>
</body></html>`;
}

function customerEmail(order: OrderWithItems, settings: ShopSettings, shopUrl: string): string {
	const awaitingTransfer = order.payment_method !== "cod" && order.payment_status === "pending";
	const qr = awaitingTransfer ? vietQrImageUrl(settings, order.total, order.order_code) : null;

	const payment = awaitingTransfer
		? `<div style="background:#fff5f8;border-radius:12px;padding:16px;margin:16px 0">
  <div style="font-size:14px;font-weight:600;color:#1e1a1e;margin-bottom:8px">Chuyển khoản để hoàn tất đơn</div>
  ${qr ? `<img src="${qr}" alt="Mã QR chuyển khoản" width="200" style="display:block;margin:0 auto 12px;border-radius:8px"/>` : ""}
  <table role="presentation" width="100%" style="font-size:13px;color:#423b41">
    ${settings.bank_id ? `<tr><td>Ngân hàng</td><td style="text-align:right">${escapeHtml(settings.bank_id)}</td></tr>` : ""}
    ${settings.bank_account_no ? `<tr><td>Số tài khoản</td><td style="text-align:right">${escapeHtml(settings.bank_account_no)}</td></tr>` : ""}
    ${settings.bank_account_name ? `<tr><td>Chủ tài khoản</td><td style="text-align:right">${escapeHtml(settings.bank_account_name)}</td></tr>` : ""}
    <tr><td>Số tiền</td><td style="text-align:right;font-weight:700;color:${BRAND}">${formatVnd(order.total)}</td></tr>
    <tr><td>Nội dung</td><td style="text-align:right;font-weight:700;color:${BRAND}">${order.order_code}</td></tr>
  </table>
</div>`
		: `<p style="font-size:14px;color:#423b41;margin:16px 0">Đơn sẽ được giao tận nơi, bạn thanh toán khi nhận hàng.</p>`;

	const inner = `<p style="margin:0 0 20px;font-size:14px;color:#7d7079">
  Cảm ơn bạn đã đặt hàng. Mã đơn của bạn là
  <strong style="color:${BRAND}">${order.order_code}</strong> — giữ lại để tra cứu.
</p>
${payment}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${itemRows(order)}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${totalsRows(order)}</table>
<div style="margin-top:20px;font-size:13px;color:#7d7079">
  <div style="font-weight:600;color:#2e282d;margin-bottom:4px">Giao tới</div>
  ${escapeHtml(order.customer_name)} · ${escapeHtml(order.customer_phone)}<br/>
  ${escapeHtml(order.customer_address)}
</div>
<a href="${shopUrl}/tra-cuu-don-hang?ma=${order.order_code}"
   style="display:inline-block;margin-top:20px;background:${BRAND};color:#fff;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px;font-weight:600">
  Theo dõi đơn hàng
</a>`;

	const contact = [settings.shop_phone && `Hotline ${settings.shop_phone}`, settings.shop_email]
		.filter(Boolean)
		.join(" · ");

	return shell(
		"Đặt hàng thành công!",
		inner,
		`${escapeHtml(settings.shop_name)}${contact ? ` — ${escapeHtml(contact)}` : ""}`,
	);
}

function ownerEmail(order: OrderWithItems, settings: ShopSettings, shopUrl: string): string {
	const inner = `<p style="margin:0 0 20px;font-size:14px;color:#7d7079">
  <strong style="color:${BRAND}">${order.order_code}</strong> · ${PAYMENT_METHOD_LABEL[order.payment_method]}
</p>
<div style="font-size:14px;color:#423b41;background:#faf8f9;border-radius:12px;padding:14px">
  <strong>${escapeHtml(order.customer_name)}</strong> · ${escapeHtml(order.customer_phone)}<br/>
  ${escapeHtml(order.customer_address)}
  ${order.note ? `<br/><span style="color:#7d7079">Ghi chú: ${escapeHtml(order.note)}</span>` : ""}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${itemRows(order)}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${totalsRows(order)}</table>
<a href="${shopUrl}/admin/don-hang"
   style="display:inline-block;margin-top:20px;background:${BRAND};color:#fff;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px;font-weight:600">
  Mở trang quản trị
</a>`;

	return shell(
		`Đơn mới — ${formatVnd(order.total)}`,
		inner,
		"Email tự động từ website bán hàng.",
	);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Đầu vào cho phía route
// ---------------------------------------------------------------------------

/**
 * Gửi email xác nhận cho khách và báo đơn mới cho chủ shop.
 *
 * KHÔNG BAO GIỜ ném lỗi ra ngoài: đơn đã nằm trong database rồi, một cú gửi
 * mail hỏng không được phép biến thành trang lỗi cho khách. Mọi kết quả — kể cả
 * bỏ qua vì chưa cấu hình — đều ghi vào email_log để còn lần ra khi cần.
 */
export async function sendOrderEmails(
	db: D1Database,
	apiKey: string | null,
	settings: ShopSettings,
	order: OrderWithItems,
	shopUrl: string,
): Promise<void> {
	const from = settings.email_from.trim();

	const log = (kind: "order_customer" | "order_owner", recipient: string, status: string, error?: string) =>
		db
			.prepare(
				`INSERT INTO email_log (order_id, kind, recipient, status, error)
				 VALUES (?1, ?2, ?3, ?4, ?5)`,
			)
			.bind(order.id, kind, recipient || "—", status, error ?? null)
			.run()
			.catch(() => undefined);

	if (!apiKey || !from) {
		await log("order_customer", order.customer_email ?? "—", "skipped", "Chưa cấu hình Resend");
		return;
	}

	const targets: { kind: "order_customer" | "order_owner"; to: string; subject: string; html: string }[] = [];

	if (order.customer_email) {
		targets.push({
			kind: "order_customer",
			to: order.customer_email,
			subject: `Đơn hàng ${order.order_code} — ${settings.shop_name}`,
			html: customerEmail(order, settings, shopUrl),
		});
	}

	if (settings.email_owner.trim()) {
		targets.push({
			kind: "order_owner",
			to: settings.email_owner.trim(),
			subject: `Đơn mới ${order.order_code} — ${formatVnd(order.total)}`,
			html: ownerEmail(order, settings, shopUrl),
		});
	}

	for (const target of targets) {
		try {
			const result = await sendEmail(apiKey, {
				from,
				to: target.to,
				subject: target.subject,
				html: target.html,
				replyTo: settings.shop_email.trim() || undefined,
			});
			await log(target.kind, target.to, result.ok ? "sent" : "failed", result.ok ? undefined : result.error);
		} catch (error) {
			await log(target.kind, target.to, "failed", String(error));
		}
	}
}

/** Gửi thử để chủ shop kiểm tra cấu hình ngay trong trang Cài đặt */
export async function sendTestEmail(
	apiKey: string,
	settings: ShopSettings,
	to: string,
): Promise<SendResult> {
	return sendEmail(apiKey, {
		from: settings.email_from.trim(),
		to,
		subject: `Thử gửi email — ${settings.shop_name}`,
		html: shell(
			"Cấu hình email hoạt động",
			`<p style="font-size:14px;color:#423b41">Nếu bạn đọc được thư này thì website đã gửi email được.
			Từ giờ khách để lại email khi đặt hàng sẽ nhận xác nhận đơn tự động.</p>`,
			`${escapeHtml(settings.shop_name)} — email thử nghiệm`,
		),
	});
}
