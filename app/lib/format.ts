/**
 * Tiện ích định dạng dùng chung cho cả server và client.
 * Tiền tệ: VND — số nguyên, phân cách hàng nghìn bằng dấu chấm, hậu tố "đ".
 * Thời gian: lưu UTC trong D1, hiển thị theo giờ Việt Nam.
 */

const TIMEZONE = "Asia/Ho_Chi_Minh";

const vndFormatter = new Intl.NumberFormat("vi-VN");

/** 289000 -> "289.000đ" */
export function formatVnd(amount: number | null | undefined): string {
	if (amount == null) return "—";
	return `${vndFormatter.format(Math.round(amount))}đ`;
}

/** 289000 -> "289.000" (không hậu tố, dùng cho input/bảng) */
export function formatNumber(amount: number | null | undefined): string {
	if (amount == null) return "";
	return vndFormatter.format(Math.round(amount));
}

/** 28560000 -> "28,6tr" — dùng cho thẻ thống kê chật chỗ */
export function formatCompactVnd(amount: number): string {
	if (amount >= 1_000_000_000) {
		return `${(amount / 1_000_000_000).toFixed(1).replace(".", ",")}tỷ`;
	}
	if (amount >= 1_000_000) {
		return `${(amount / 1_000_000).toFixed(1).replace(".", ",")}tr`;
	}
	if (amount >= 1_000) {
		return `${Math.round(amount / 1_000)}k`;
	}
	return String(amount);
}

/** Gỡ mọi ký tự không phải số khỏi chuỗi nhập tiền: "289.000đ" -> 289000 */
export function parseVnd(input: string | null | undefined): number {
	if (!input) return 0;
	const digits = String(input).replace(/[^\d]/g, "");
	return digits ? Number.parseInt(digits, 10) : 0;
}

/** Chuỗi ISO/SQLite UTC -> "14:30 12/04/2026" theo giờ VN */
export function formatDateTime(value: string | null | undefined): string {
	const date = toDate(value);
	if (!date) return "—";
	return new Intl.DateTimeFormat("vi-VN", {
		timeZone: TIMEZONE,
		hour: "2-digit",
		minute: "2-digit",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	}).format(date);
}

/** Chuỗi ISO/SQLite UTC -> "12/04/2026" theo giờ VN */
export function formatDate(value: string | null | undefined): string {
	const date = toDate(value);
	if (!date) return "—";
	return new Intl.DateTimeFormat("vi-VN", {
		timeZone: TIMEZONE,
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	}).format(date);
}

/** "5 phút trước", "2 giờ trước", "3 ngày trước" */
export function formatRelative(value: string | null | undefined): string {
	const date = toDate(value);
	if (!date) return "—";
	const diffMs = Date.now() - date.getTime();
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 1) return "vừa xong";
	if (minutes < 60) return `${minutes} phút trước`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} giờ trước`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} ngày trước`;
	return formatDate(value);
}

/**
 * D1 trả về chuỗi dạng "2026-04-12 07:30:00" (UTC, không có hậu tố Z).
 * Date của JS sẽ hiểu nhầm là giờ địa phương nên phải chuẩn hoá về ISO có Z.
 */
function toDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
		? `${value.replace(" ", "T")}Z`
		: value;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Thời điểm hiện tại theo định dạng D1 lưu trữ: "2026-04-12 07:30:00" (UTC) */
export function sqlNow(offsetMs = 0): string {
	return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// Hẹn giờ theo giờ Việt Nam
//
// Ô <input type="datetime-local"> cho ra chuỗi "2026-09-23T10:00" không mang
// thông tin múi giờ. Shop bán ở Việt Nam và mọi thời gian khác trong hệ thống
// đều hiển thị theo giờ VN, nên chuỗi đó luôn được hiểu là giờ VN — kể cả khi
// chủ shop đang ngồi ở múi giờ khác.
// ---------------------------------------------------------------------------

const VN_OFFSET = "+07:00";

/** "2026-09-23T10:00" -> "2026-09-23T10:00:00+07:00" (gửi cho Typefully) */
export function vnLocalToIso(local: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
	return `${local}:00${VN_OFFSET}`;
}

/** "2026-09-23T10:00" -> "2026-09-23 03:00:00" (UTC, để lưu vào D1) */
export function vnLocalToSqlUtc(local: string): string | null {
	const iso = vnLocalToIso(local);
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Giờ VN hiện tại (cộng thêm `offsetMinutes` nếu cần) ở dạng ô datetime-local
 * nhận được: "YYYY-MM-DDTHH:mm".
 */
export function vnLocalInput(offsetMinutes = 0): string {
	const vn = new Date(Date.now() + (7 * 60 + offsetMinutes) * 60_000);
	return vn.toISOString().slice(0, 16);
}

/**
 * Mốc giờ VN cho các nút gợi ý nhanh: `daysAhead` ngày nữa, vào đúng `hour` giờ.
 * vd vnLocalAt(1, 10) = 10:00 sáng mai.
 */
export function vnLocalAt(daysAhead: number, hour: number): string {
	const vn = new Date(Date.now() + 7 * 60 * 60_000);
	vn.setUTCDate(vn.getUTCDate() + daysAhead);
	vn.setUTCHours(hour, 0, 0, 0);
	return vn.toISOString().slice(0, 16);
}

/**
 * Sinh slug từ tiếng Việt có dấu:
 *   "Đầm hoa nhí tay bồng" -> "dam-hoa-nhi-tay-bong"
 */
export function slugify(input: string): string {
	return input
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // bỏ dấu thanh + dấu mũ
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

/** Chuẩn hoá số điện thoại VN về dạng 0xxxxxxxxx để so khớp khách quen */
export function normalizePhone(input: string): string {
	const digits = input.replace(/[^\d+]/g, "");
	if (digits.startsWith("+84")) return `0${digits.slice(3)}`;
	if (digits.startsWith("84") && digits.length >= 10) return `0${digits.slice(2)}`;
	return digits;
}

export function isValidPhone(input: string): boolean {
	return /^0\d{9}$/.test(normalizePhone(input));
}

/** Gộp class Tailwind có điều kiện mà không cần thêm dependency */
export function cn(...values: Array<string | false | null | undefined>): string {
	return values.filter(Boolean).join(" ");
}
