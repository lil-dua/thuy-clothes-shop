/**
 * Ghi nhớ các mã đơn mà trình duyệt này vừa đặt hoặc vừa tra cứu thành công.
 *
 * Lý do: trang /don-hang/:ma chứa tên, số điện thoại và địa chỉ khách. Mã đơn
 * chỉ có 5 chữ số nên hoàn toàn có thể dò được. Vì vậy trang chi tiết chỉ mở
 * khi mã nằm trong cookie này — tức là người xem hoặc vừa đặt đơn, hoặc đã
 * nhập đúng số điện thoại ở trang tra cứu.
 *
 * Cookie BẮT BUỘC phải được ký (HMAC, qua `secrets` của react-router) bằng
 * COOKIE_SECRET. httpOnly chỉ chặn JavaScript phía trình duyệt đọc cookie —
 * nó không chặn ai đó tự ghép header `Cookie: lumi_orders=<base64 JSON>` bằng
 * curl/Postman. Không ký thì bất kỳ ai cũng tự đặt được danh sách mã đơn muốn
 * xem, vô hiệu hoá hoàn toàn lớp bảo vệ này (IDOR).
 *
 * Thiếu COOKIE_SECRET (chưa cấu hình ở `.dev.vars` hoặc `wrangler secret put`)
 * → toàn bộ hàm trong file này coi như KHÔNG có đơn nào được ghi nhớ
 * (fail-closed). Tuyệt đối không được âm thầm rơi về cookie không ký.
 */

import { createCookie } from "react-router";

const COOKIE_NAME = "lumi_orders";
const MAX_CODES = 20;

let warnedMissingSecret = false;

// Workers không có biến môi trường ở phạm vi module — secret chỉ đọc được
// trong loader/action qua `context.cloudflare.env`. Cache lại cookie đã tạo
// theo giá trị secret để không phải tạo mới ở mỗi lần gọi trong cùng request.
let cached: { secret: string; cookie: ReturnType<typeof createCookie> } | null = null;

function cookieFor(secret: string) {
	if (cached?.secret !== secret) {
		cached = {
			secret,
			cookie: createCookie(COOKIE_NAME, {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				// http://localhost không phải HTTPS — bật Secure ở dev sẽ khiến trình
				// duyệt lặng lẽ bỏ qua cookie.
				secure: import.meta.env.PROD,
				maxAge: 60 * 60 * 24 * 90, // 90 ngày
				secrets: [secret],
			}),
		};
	}
	return cached.cookie;
}

/**
 * Đọc COOKIE_SECRET từ env Cloudflare. Đặt bằng `wrangler secret put COOKIE_SECRET`
 * ở production, hoặc dòng `COOKIE_SECRET=...` trong `.dev.vars` ở local
 * (xem `.dev.vars.example`). Không có trong `wrangler.json` vì đây là bí mật,
 * không phải cấu hình công khai.
 */
// Chuỗi mẫu trong `.dev.vars.example` — nếu ai đó copy nguyên file mà quên đổi
// giá trị, secret coi như công khai (ai đọc repo cũng biết) → phải từ chối.
const PLACEHOLDER_SECRET = "doi-chuoi-nay-thanh-gia-tri-ngau-nhien-dai-it-nhat-32-ky-tu";
const MIN_SECRET_LENGTH = 32;

export function getCookieSecret(env: Record<string, unknown>): string | null {
	const value = env.COOKIE_SECRET;
	const trimmed = typeof value === "string" ? value.trim() : "";
	const weak =
		!trimmed || trimmed.length < MIN_SECRET_LENGTH || trimmed === PLACEHOLDER_SECRET;
	if (weak) {
		if (!warnedMissingSecret) {
			warnedMissingSecret = true;
			console.error(
				"[recent-orders] Thiếu hoặc COOKIE_SECRET quá yếu (rỗng, ngắn hơn " +
					`${MIN_SECRET_LENGTH} ký tự, hoặc trùng chuỗi mẫu trong .dev.vars.example) — ` +
					"cookie lumi_orders sẽ không được ký, mọi yêu cầu xem đơn hàng qua cookie sẽ bị " +
					"từ chối (fail-closed) cho tới khi cấu hình một secret ngẫu nhiên đủ mạnh.",
			);
		}
		return null;
	}
	return trimmed;
}

export async function readRecentOrders(request: Request, secret: string | null): Promise<string[]> {
	if (!secret) return [];

	const header = request.headers.get("Cookie");
	if (!header) return [];

	let raw: unknown;
	try {
		raw = await cookieFor(secret).parse(header);
	} catch {
		// Cookie cũ (từ trước khi có chữ ký) hoặc bị sửa tay — coi như rỗng,
		// không văng lỗi 500.
		return [];
	}
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((value): value is string => typeof value === "string" && /^[A-Z0-9]{4,16}$/.test(value))
		.slice(0, MAX_CODES);
}

/**
 * Trả về header Set-Cookie đã ký, hoặc `null` nếu thiếu COOKIE_SECRET.
 * Gọi nơi dùng PHẢI xử lý mềm trường hợp `null` — không văng lỗi 500, đơn
 * hàng đã tạo vẫn phải hiển thị trang cảm ơn bình thường; khách chỉ mất tiện
 * ích "xem lại đơn không cần nhập lại SĐT".
 */
export async function rememberOrder(
	request: Request,
	code: string,
	secret: string | null,
): Promise<string | null> {
	if (!secret) return null;
	const existing = await readRecentOrders(request, secret);
	const next = [code, ...existing.filter((value) => value !== code)].slice(0, MAX_CODES);
	return cookieFor(secret).serialize(next);
}

export async function canViewOrder(
	request: Request,
	code: string,
	secret: string | null,
): Promise<boolean> {
	return (await readRecentOrders(request, secret)).includes(code);
}
