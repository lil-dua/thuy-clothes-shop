#!/usr/bin/env node
/**
 * Sao lưu cơ sở dữ liệu D1 ra file .sql trên máy.
 *
 * Vì sao cần: D1 gói miễn phí KHÔNG có point-in-time recovery. Một câu lệnh
 * DELETE chạy nhầm vào `--remote`, hoặc một lần `db:reset` gõ sai cờ, là mất
 * toàn bộ đơn hàng và không có cách nào lấy lại. Bản export .sql là lưới an
 * toàn duy nhất, và nó chỉ mất vài giây.
 *
 * Cách dùng:
 *   npm run db:backup            # sao lưu D1 trên Cloudflare (dữ liệu thật)
 *   npm run db:backup -- --local # sao lưu D1 dưới máy (để thử script)
 *   npm run db:backup -- --keep 30
 *
 * File ra: backups/lumi-shop-db-2026-09-26-1430.sql (đã có trong .gitignore —
 * bản sao lưu chứa tên, số điện thoại, địa chỉ khách hàng, đừng bao giờ commit).
 *
 * Nên chạy trước mỗi lần deploy có migration, và định kỳ hằng tuần.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = join(ROOT, "backups");
const DB_NAME = "lumi-shop-db";
const PREFIX = `${DB_NAME}-`;

const args = process.argv.slice(2);
const local = args.includes("--local");
const keep = parseKeep(args);

function parseKeep(argv) {
	const index = argv.indexOf("--keep");
	if (index === -1) return 14;
	const value = Number.parseInt(argv[index + 1] ?? "", 10);
	if (!Number.isInteger(value) || value < 1) {
		console.error("--keep cần một số nguyên ≥ 1");
		process.exit(1);
	}
	return value;
}

/** Tên file theo giờ Việt Nam, để xem lại khớp với giờ đơn hàng trong admin */
function timestamp() {
	const vn = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
	return `${vn.slice(0, 10)}-${vn.slice(11, 13)}${vn.slice(14, 16)}`;
}

function humanSize(bytes) {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
	return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** Xoá bản cũ, giữ lại `keep` bản mới nhất */
function prune() {
	const files = readdirSync(BACKUP_DIR)
		.filter((name) => name.startsWith(PREFIX) && name.endsWith(".sql"))
		.sort()
		.reverse();

	for (const name of files.slice(keep)) {
		unlinkSync(join(BACKUP_DIR, name));
		console.log(`  đã xoá bản cũ: ${name}`);
	}
	return files.length;
}

mkdirSync(BACKUP_DIR, { recursive: true });

const name = `${PREFIX}${local ? "local-" : ""}${timestamp()}.sql`;
const target = join(BACKUP_DIR, name);

console.log(`Đang sao lưu ${DB_NAME} (${local ? "local" : "Cloudflare"})...`);

try {
	// wrangler d1 export tự ghi ra file qua --output, không cần bắt stdout
	execFileSync(
		"npx",
		[
			"wrangler",
			"d1",
			"export",
			DB_NAME,
			local ? "--local" : "--remote",
			"--output",
			target,
			"--skip-confirmation",
		],
		{ cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
	);
} catch {
	// wrangler đã in lỗi của nó ở trên rồi, đừng lặp lại
	console.error("\n✗ Sao lưu thất bại. Kiểm tra `npx wrangler whoami` trước.");
	process.exit(1);
}

const size = statSync(target).size;
if (size === 0) {
	unlinkSync(target);
	console.error("✗ File sao lưu rỗng — đã xoá. Có thể database chưa có bảng nào.");
	process.exit(1);
}

console.log(`\n✓ ${name} (${humanSize(size)})`);

const total = prune();
console.log(`  backups/ đang giữ ${Math.min(total, keep)}/${keep} bản`);

// Câu lệnh khôi phục phải trỏ về đúng nơi đã export. Gợi ý --remote cho một
// bản sao lưu local là cách nhanh nhất để đẩy dữ liệu thử lên dữ liệu thật.
console.log(`
Khôi phục khi cần:
  npx wrangler d1 execute ${DB_NAME} ${local ? "--local" : "--remote"} --file backups/${name} --yes

Lưu ý: file này chứa thông tin khách hàng. Giữ trong máy hoặc ổ mã hoá,
không commit lên git, không upload lên nơi dùng chung.`);
