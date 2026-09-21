/**
 * Đăng nhập quản trị.
 *
 * Khách mua hàng KHÔNG cần tài khoản — lớp này chỉ phục vụ admin.
 * Token phiên là chuỗi ngẫu nhiên lưu trong bảng admin_sessions, nhờ vậy có thể
 * thu hồi phiên ngay lập tức (đăng xuất, khoá tài khoản) — điều mà cookie tự ký
 * không làm được.
 */

import { createCookie, redirect } from "react-router";
import type { AdminUser } from "./types";
import { sqlNow } from "./format";

const SESSION_COOKIE_NAME = "lumi_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 ngày
const PBKDF2_ITERATIONS = 100_000;

export const adminSessionCookie = createCookie(SESSION_COOKIE_NAME, {
	httpOnly: true,
	sameSite: "lax",
	path: "/",
	// http://localhost không phải HTTPS — bật Secure ở dev sẽ khiến trình
	// duyệt lặng lẽ bỏ qua cookie, đăng nhập và giỏ hàng đều không hoạt động.
	secure: import.meta.env.PROD,
	maxAge: SESSION_TTL_MS / 1000,
});

// ---------------------------------------------------------------------------
// Mật khẩu — PBKDF2-SHA256 qua WebCrypto (có sẵn trong Workers runtime)
// Định dạng lưu trữ: pbkdf2$<iterations>$<salt_base64>$<hash_base64>
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await derive(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

	const iterations = Number.parseInt(parts[1], 10);
	if (!Number.isFinite(iterations) || iterations <= 0) return false;

	const salt = fromBase64(parts[2]);
	const expected = fromBase64(parts[3]);
	const actual = await derive(password, salt, iterations);
	return timingSafeEqual(expected, actual);
}

async function derive(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
		key,
		256,
	);
	return new Uint8Array(bits);
}

/** So sánh không phụ thuộc thời gian để không rò rỉ thông tin qua độ trễ */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

function toBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// ---------------------------------------------------------------------------
// Phiên đăng nhập
// ---------------------------------------------------------------------------

export interface LoginResult {
	ok: boolean;
	error?: string;
	setCookie?: string;
}

export async function login(
	db: D1Database,
	username: string,
	password: string,
): Promise<LoginResult> {
	const user = await db
		.prepare(
			`SELECT id, username, password_hash, display_name, role, is_active
			 FROM admin_users WHERE username = ?1`,
		)
		.bind(username.trim().toLowerCase())
		.first<{
			id: number;
			username: string;
			password_hash: string;
			display_name: string;
			role: string;
			is_active: number;
		}>();

	// Cùng một thông báo cho "sai tên" và "sai mật khẩu" — không tiết lộ
	// tài khoản nào tồn tại.
	const GENERIC_ERROR = "Tên đăng nhập hoặc mật khẩu không đúng";
	if (!user || !user.is_active) {
		// Vẫn chạy một lần derive để thời gian phản hồi không khác biệt rõ rệt.
		await derive(password, new Uint8Array(16), PBKDF2_ITERATIONS);
		return { ok: false, error: GENERIC_ERROR };
	}

	const valid = await verifyPassword(password, user.password_hash);
	if (!valid) return { ok: false, error: GENERIC_ERROR };

	const token = randomToken();
	const expiresAt = sqlNow(SESSION_TTL_MS);

	await db.batch([
		db
			.prepare(
				`INSERT INTO admin_sessions (token, admin_user_id, expires_at) VALUES (?1, ?2, ?3)`,
			)
			.bind(token, user.id, expiresAt),
		db
			.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?1`)
			.bind(user.id),
		// Dọn phiên hết hạn nhân tiện mỗi lần đăng nhập
		db.prepare(`DELETE FROM admin_sessions WHERE expires_at < datetime('now')`),
	]);

	return { ok: true, setCookie: await adminSessionCookie.serialize(token) };
}

export async function logout(db: D1Database, request: Request): Promise<string> {
	const token = await readToken(request);
	if (token) {
		await db.prepare(`DELETE FROM admin_sessions WHERE token = ?1`).bind(token).run();
	}
	return adminSessionCookie.serialize("", { maxAge: 0 });
}

/** Trả về admin đang đăng nhập, hoặc null. Không redirect. */
export async function getAdminUser(
	db: D1Database,
	request: Request,
): Promise<AdminUser | null> {
	const token = await readToken(request);
	if (!token) return null;

	const row = await db
		.prepare(
			`SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.last_login_at
			 FROM admin_sessions s
			 JOIN admin_users u ON u.id = s.admin_user_id
			 WHERE s.token = ?1 AND s.expires_at > datetime('now') AND u.is_active = 1`,
		)
		.bind(token)
		.first<AdminUser>();

	return row ?? null;
}

/** Bắt buộc đã đăng nhập — nếu chưa thì ném redirect về trang đăng nhập. */
export async function requireAdmin(
	db: D1Database,
	request: Request,
): Promise<AdminUser> {
	const user = await getAdminUser(db, request);
	if (!user) {
		const url = new URL(request.url);
		const next = encodeURIComponent(url.pathname + url.search);
		throw redirect(`/admin/dang-nhap?next=${next}`);
	}
	return user;
}

async function readToken(request: Request): Promise<string | null> {
	const cookieHeader = request.headers.get("Cookie");
	if (!cookieHeader) return null;
	const value = await adminSessionCookie.parse(cookieHeader);
	return typeof value === "string" && value.length > 0 ? value : null;
}

function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
