/**
 * Giới hạn tần suất (rate limiting) đơn giản, không thêm dependency ngoài —
 * đếm số lần thử trong một "cửa sổ" thời gian cố định (fixed window) cho một
 * cặp (scope, identifier), lưu trong bảng D1 `rate_limits` (migration 0007).
 *
 * Không phải giải pháp chống DDoS phân tán — trong phạm vi audit này chỉ cần
 * cản trở dò mật khẩu admin / dò cặp (mã đơn, số điện thoại) / spam đặt đơn
 * từ một IP hoặc một số ít IP. Cấu hình Cloudflare Rate Limiting rules ở tầng
 * mạng (WAF) nên làm thêm ở production nhưng nằm ngoài repo này.
 */

export interface RateLimitRule {
	/** Định danh nhóm giới hạn, ví dụ "admin-login" */
	scope: string;
	/** Số lần cho phép trong một cửa sổ */
	limit: number;
	windowSeconds: number;
}

export interface RateLimitResult {
	allowed: boolean;
	/** Số giây nên chờ trước khi thử lại — dùng cho cả header Retry-After và thông báo */
	retryAfterSeconds: number;
}

/**
 * Ghi nhận một lần thử cho `key` trong `rule.scope` và trả về đã vượt ngưỡng
 * hay chưa. Gọi hàm này ngay khi request tới (trước khi làm việc tốn CPU như
 * PBKDF2), để chặn sớm nhất có thể.
 */
export async function checkRateLimit(
	db: D1Database,
	rule: RateLimitRule,
	key: string,
): Promise<RateLimitResult> {
	const windowMs = rule.windowSeconds * 1000;
	const now = Date.now();
	const windowStartMs = Math.floor(now / windowMs) * windowMs;
	const windowStart = new Date(windowStartMs).toISOString();
	const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));

	// Dọn cửa sổ cũ theo xác suất thấp (~1%) thay vì mỗi lần gọi — bảng nhỏ nên
	// không cần cron riêng, nhưng dọn ở MỌI lần gọi sẽ khuếch đại số lượt ghi D1
	// ở các hot path (ví dụ `/api/gio-hang` — 60 lần/phút cho mỗi khách).
	if (Math.random() < 0.01) {
		const previousWindowStart = new Date(windowStartMs - windowMs).toISOString();
		await db
			.prepare(`DELETE FROM rate_limits WHERE scope = ?1 AND window_start <= ?2`)
			.bind(rule.scope, previousWindowStart)
			.run();
	}

	const row = await db
		.prepare(
			`INSERT INTO rate_limits (scope, identifier, window_start, count)
			 VALUES (?1, ?2, ?3, 1)
			 ON CONFLICT(scope, identifier, window_start)
			 DO UPDATE SET count = count + 1
			 RETURNING count`,
		)
		.bind(rule.scope, key || "unknown", windowStart)
		.first<{ count: number }>();

	const count = row?.count ?? 1;
	return { allowed: count <= rule.limit, retryAfterSeconds };
}

/**
 * Bản "fail-soft" (fail-open) của `checkRateLimit` — dùng cho các luồng mua
 * hàng thật (giỏ hàng, đặt đơn) nơi ưu tiên KHÔNG làm sập luồng nếu D1 lỗi
 * hoặc migration `0007_rate_limit.sql` chưa được áp (bảng `rate_limits` chưa
 * tồn tại): lỗi ghi/đọc D1 sẽ được coi như "cho qua" (không chặn khách hàng
 * thật) thay vì để lỗi 500 lan ra ngoài. Ngược lại, đăng nhập admin/tra cứu
 * đơn hàng vẫn dùng `checkRateLimit` gốc (fail-closed) vì đó là nơi cần chặn
 * chắc chắn hơn là chặn được ưu tiên trải nghiệm.
 */
export async function checkRateLimitSoft(
	db: D1Database,
	rule: RateLimitRule,
	key: string,
): Promise<RateLimitResult> {
	try {
		return await checkRateLimit(db, rule, key);
	} catch (err) {
		console.error(`[rate-limit] fail-open cho scope="${rule.scope}":`, err);
		return { allowed: true, retryAfterSeconds: 0 };
	}
}

/** IP của khách — Cloudflare luôn set header này, kể cả ở `wrangler dev`. */
export function clientIp(request: Request): string {
	return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/** Thông báo tiếng Việt dùng chung, kèm số phút làm tròn lên cho dễ đọc */
export function rateLimitMessage(retryAfterSeconds: number): string {
	const minutes = Math.ceil(retryAfterSeconds / 60);
	return minutes <= 1
		? "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút."
		: `Bạn thao tác quá nhanh, vui lòng thử lại sau khoảng ${minutes} phút.`;
}
