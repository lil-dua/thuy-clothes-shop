#!/usr/bin/env node
/**
 * Tạo (hoặc đổi mật khẩu) tài khoản quản trị.
 *
 * Mật khẩu được băm bằng PBKDF2-SHA256 ngay tại máy bạn — chỉ chuỗi băm đi vào
 * database, không có mật khẩu nào nằm trong repo hay trong lịch sử migration.
 *
 * Dùng:
 *   node scripts/create-admin.mjs <tên-đăng-nhập> <mật-khẩu> ["Tên hiển thị"]
 *   node scripts/create-admin.mjs thuy 'MatKhauManh!2026' 'Chị Thuý' --remote
 */

import { webcrypto as crypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATABASE = "lumi-shop-db";
const ITERATIONS = 100_000;

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const positional = args.filter((value) => !value.startsWith("--"));
const [username, password, displayName] = positional;

if (!username || !password) {
	console.error(
		`Thiếu tham số.

  node scripts/create-admin.mjs <tên-đăng-nhập> <mật-khẩu> ["Tên hiển thị"] [--remote]

Ví dụ:
  node scripts/create-admin.mjs thuy 'MatKhauManh!2026' 'Chị Thuý'`,
	);
	process.exit(1);
}

if (password.length < 8) {
	console.error("Mật khẩu cần ít nhất 8 ký tự.");
	process.exit(1);
}

const hash = await hashPassword(password);
const user = username.trim().toLowerCase();
const name = displayName?.trim() || username;

// Dùng tệp .sql tạm thay vì --command để mật khẩu băm không lọt vào
// lịch sử lệnh của shell.
const sql = `
INSERT INTO admin_users (username, password_hash, display_name, role)
VALUES ('${escape(user)}', '${hash}', '${escape(name)}', 'owner')
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  display_name = excluded.display_name,
  is_active = 1;
-- Đổi mật khẩu thì mọi phiên cũ phải đăng nhập lại
DELETE FROM admin_sessions
WHERE admin_user_id = (SELECT id FROM admin_users WHERE username = '${escape(user)}');
`;

const dir = mkdtempSync(join(tmpdir(), "lumi-admin-"));
const file = join(dir, "create-admin.sql");
writeFileSync(file, sql, { mode: 0o600 });

try {
	execFileSync(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			DATABASE,
			"--file",
			file,
			remote ? "--remote" : "--local",
			"--yes",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	console.log(
		`Đã tạo/cập nhật tài khoản quản trị "${user}" trên database ${remote ? "remote" : "local"}.`,
	);
	console.log("Đăng nhập tại /admin/dang-nhap");
} catch (error) {
	console.error("Không chạy được wrangler:");
	console.error(error.stderr?.toString() ?? error.message);
	process.exit(1);
}

/** Cùng định dạng với verifyPassword trong app/lib/auth.server.ts */
async function hashPassword(plain) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(plain),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
		key,
		256,
	);
	return `pbkdf2$${ITERATIONS}$${base64(salt)}$${base64(new Uint8Array(bits))}`;
}

function base64(bytes) {
	return Buffer.from(bytes).toString("base64");
}

function escape(value) {
	return value.replace(/'/g, "''");
}
