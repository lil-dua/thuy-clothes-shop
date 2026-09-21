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
}

export const DEFAULT_SETTINGS: ShopSettings = {
	shop_name: "Lumi",
	shop_tagline: "Thời trang cho những khoảnh khắc đẹp nhất",
	shop_phone: "",
	shop_email: "",
	shop_address: "",
	threads_handle: "",
	bank_id: "",
	bank_account_no: "",
	bank_account_name: "",
	momo_phone: "",
	momo_name: "",
	momo_qr_key: "",
	shipping_fee: "30000",
	free_shipping_threshold: "500000",
	order_hold_minutes: "30",
	return_policy_days: "7",
};

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
