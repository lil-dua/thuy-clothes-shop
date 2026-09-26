/**
 * Cấu hình shop lưu trong bảng `settings` (key/value) để chủ shop tự sửa
 * trong trang quản trị mà không cần deploy lại: số tài khoản, phí ship,
 * ngưỡng miễn phí vận chuyển...
 */

export interface ShopSettings {
	shop_name: string;
	shop_tagline: string;
	shop_phone: string;
	shop_email: string;
	shop_address: string;
	threads_handle: string;
	/** Mã ngân hàng theo chuẩn VietQR, vd "VCB", "TCB", "MB" */
	bank_id: string;
	bank_account_no: string;
	bank_account_name: string;
	momo_phone: string;
	momo_name: string;
	/** Key ảnh QR MoMo trong R2 (nếu chủ shop tải ảnh QR cá nhân lên) */
	momo_qr_key: string;
	shipping_fee: string;
	free_shipping_threshold: string;
	/** Số phút giữ chỗ tồn kho cho đơn chuyển khoản/MoMo chưa thanh toán */
	order_hold_minutes: string;
	return_policy_days: string;
	/** Tài khoản Typefully dùng để đăng bài — id lấy từ API, tên chỉ để hiển thị */
	typefully_social_set_id: string;
	typefully_social_set_name: string;
	/** Mẫu caption sinh bài đăng Threads, xem THREADS_PLACEHOLDERS */
	threads_caption_template: string;
	/** '1' = tự đăng Threads ngay khi thêm sản phẩm mới */
	threads_auto_post: string;
	/** Địa chỉ gửi, dạng "Lumi <donhang@tenmien.com>" — domain phải xác minh ở Resend */
	email_from: string;
	/** Nơi nhận thông báo đơn mới; để trống thì không báo cho chủ shop */
	email_owner: string;
}

/** Mẫu caption mặc định — chủ shop sửa lại được trong trang Cài đặt */
export const DEFAULT_CAPTION_TEMPLATE = `{ten}

💰 {gia}
📏 Size: {size}
🎨 Màu: {mau}

{mota}

🛒 Đặt hàng: {link}`;

export const DEFAULT_SETTINGS: ShopSettings = {
	shop_name: "Lumi",
	shop_tagline: "Thời trang cho những khoảnh khắc đẹp nhất",
	shop_phone: "0346886107",
	shop_email: "",
	shop_address: "",
	threads_handle: "",
	bank_id: "",
	bank_account_no: "",
	bank_account_name: "",
	momo_phone: "0346886107",
	momo_name: "",
	momo_qr_key: "",
	shipping_fee: "30000",
	free_shipping_threshold: "500000",
	order_hold_minutes: "30",
	return_policy_days: "7",
	typefully_social_set_id: "",
	typefully_social_set_name: "",
	threads_caption_template: DEFAULT_CAPTION_TEMPLATE,
	threads_auto_post: "0",
	email_from: "",
	email_owner: "",
};

/**
 * Khoá bí mật cũng nằm trong bảng `settings` nhưng CỐ Ý không có trong
 * DEFAULT_SETTINGS. Nhờ vậy `getSettings` không bao giờ đọc ra chúng, và
 * loader của trang Cài đặt không thể vô tình gửi API key xuống trình duyệt.
 * Đọc/ghi phải đi qua getSecret / setSecret.
 */
export const SECRET_KEYS = ["typefully_api_key", "resend_api_key"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export async function getSettings(db: D1Database): Promise<ShopSettings> {
	const { results } = await db
		.prepare(`SELECT key, value FROM settings`)
		.all<{ key: string; value: string | null }>();

	const settings = { ...DEFAULT_SETTINGS };
	for (const row of results ?? []) {
		if (row.key in settings && row.value != null && row.value !== "") {
			settings[row.key as keyof ShopSettings] = row.value;
		}
	}
	return settings;
}

export async function updateSettings(
	db: D1Database,
	values: Partial<Record<keyof ShopSettings, string>>,
): Promise<void> {
	const statements = Object.entries(values)
		.filter(([key]) => key in DEFAULT_SETTINGS)
		.map(([key, value]) =>
			db
				.prepare(
					`INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
					 ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')`,
				)
				.bind(key, value ?? ""),
		);
	if (statements.length > 0) await db.batch(statements);
}

// ---------------------------------------------------------------------------
// Khoá bí mật
// ---------------------------------------------------------------------------

/**
 * Ưu tiên biến môi trường (Cloudflare secret) rồi mới tới bảng settings.
 * Secret an toàn hơn, nhưng phải chạy `wrangler secret put` — nên vẫn để chủ
 * shop dán khoá thẳng trong trang Cài đặt nếu muốn tự làm.
 */
export async function getSecret(
	db: D1Database,
	key: SecretKey,
	env?: Record<string, unknown>,
): Promise<string | null> {
	const fromEnv = env?.[key.toUpperCase()];
	if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();

	const row = await db
		.prepare(`SELECT value FROM settings WHERE key = ?1`)
		.bind(key)
		.first<{ value: string | null }>();
	return row?.value?.trim() || null;
}

export async function setSecret(
	db: D1Database,
	key: SecretKey,
	value: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')`,
		)
		.bind(key, value.trim())
		.run();
}

/** Chỉ cho biết đã cấu hình hay chưa — không bao giờ trả về giá trị thật */
export async function hasSecret(
	db: D1Database,
	key: SecretKey,
	env?: Record<string, unknown>,
): Promise<boolean> {
	return (await getSecret(db, key, env)) !== null;
}

// ---------------------------------------------------------------------------
// Vận chuyển & thanh toán
// ---------------------------------------------------------------------------

/** Phí vận chuyển áp dụng cho một giá trị đơn hàng cụ thể */
export function shippingFeeFor(settings: ShopSettings, subtotal: number): number {
	const threshold = Number.parseInt(settings.free_shipping_threshold, 10) || 0;
	if (threshold > 0 && subtotal >= threshold) return 0;
	return Number.parseInt(settings.shipping_fee, 10) || 0;
}

/**
 * Link ảnh QR chuyển khoản của VietQR (quicklink, không cần API key).
 * Số tiền và nội dung được điền sẵn nên khách không gõ sai mã đơn.
 */
export function vietQrImageUrl(
	settings: ShopSettings,
	amount: number,
	orderCode: string,
): string | null {
	if (!settings.bank_id || !settings.bank_account_no) return null;
	const params = new URLSearchParams({
		amount: String(amount),
		addInfo: orderCode,
		accountName: settings.bank_account_name,
	});
	return `https://img.vietqr.io/image/${encodeURIComponent(settings.bank_id)}-${encodeURIComponent(
		settings.bank_account_no,
	)}-compact2.png?${params.toString()}`;
}
