#!/usr/bin/env node
/**
 * Nạp ảnh minh hoạ cho dữ liệu mẫu vào R2.
 *
 * Ảnh là SVG dựng bằng code (không phải ảnh chụp thật) để repo không phải
 * kèm tệp nhị phân, và để chạy thử giao diện không cần chờ chủ shop chụp hàng.
 * Khi có ảnh thật, chỉ cần tải lên trong trang quản trị — các key demo/* này
 * có thể xoá đi.
 *
 * Dùng:  node scripts/seed-images.mjs [--remote]
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Node 24 nạp thẳng được .ts, nên hình vẽ chỉ định nghĩa một chỗ: sửa trong
// app/lib/placeholder-shapes.ts là cả ảnh mặc định lẫn ảnh mẫu đổi theo.
import { renderPlaceholderSvg } from "../app/lib/placeholder-shapes.ts";

const BUCKET = "lumi-shop-images";
const remote = process.argv.includes("--remote");

/** Mỗi sản phẩm một bảng màu + kiểu dáng, để lưới sản phẩm không bị đơn điệu */
const IMAGES = [
	{ key: "demo/p1-a.svg", shape: "dress", from: "#FDE8EF", to: "#F7C6D9", accent: "#E79BB6", label: "Đầm hoa nhí" },
	{ key: "demo/p1-b.svg", shape: "dress", from: "#E8F5F1", to: "#BFE3DA", accent: "#8FC9BC", label: "Đầm hoa nhí" },
	{ key: "demo/p2-a.svg", shape: "maxi", from: "#F7F0E6", to: "#E8D8C3", accent: "#CBB496", label: "Đầm maxi" },
	{ key: "demo/p3-a.svg", shape: "dress", from: "#FAFAFA", to: "#EDEDF2", accent: "#C9C9D4", label: "Đầm lụa" },
	{ key: "demo/p4-a.svg", shape: "babydoll", from: "#FFFFFF", to: "#F4F1F3", accent: "#DCD3D8", label: "Babydoll" },
	{ key: "demo/p5-a.svg", shape: "tee", from: "#FFFFFF", to: "#F2F2F4", accent: "#D4D4DA", label: "Áo thun" },
	{ key: "demo/p6-a.svg", shape: "shirt", from: "#FAF3E9", to: "#F3E9DC", accent: "#D9C6AE", label: "Sơ mi lụa" },
	{ key: "demo/p7-a.svg", shape: "pants", from: "#EAF1F8", to: "#A8BFD6", accent: "#7D9CBC", label: "Quần jean" },
	{ key: "demo/p8-a.svg", shape: "skirt", from: "#F0EFF1", to: "#CFCCD2", accent: "#8E8992", label: "Chân váy" },
	{ key: "demo/p9-a.svg", shape: "set", from: "#F7F1E8", to: "#E8D8C3", accent: "#C3AB8C", label: "Set linen" },
	{ key: "demo/p10-a.svg", shape: "kidsdress", from: "#FDE8EF", to: "#F7C6D9", accent: "#E79BB6", label: "Váy bé gái" },
	{ key: "demo/p10-b.svg", shape: "kidsdress", from: "#FFFFFF", to: "#F2F2F4", accent: "#D6D6DC", label: "Váy bé gái" },
	{ key: "demo/p11-a.svg", shape: "set", from: "#FCF4DC", to: "#F6E1A6", accent: "#DCC173", label: "Set bé gái" },
	{ key: "demo/p12-a.svg", shape: "tee", from: "#E8F5F1", to: "#BFE3DA", accent: "#8FC9BC", label: "Áo bé trai" },
	{ key: "demo/p13-a.svg", shape: "shorts", from: "#F7F1E8", to: "#E8D8C3", accent: "#C3AB8C", label: "Short bé" },
	{ key: "demo/p14-a.svg", shape: "hat", from: "#FDE8EF", to: "#F7C6D9", accent: "#E79BB6", label: "Mũ bé gái" },
];

const dir = mkdtempSync(join(tmpdir(), "lumi-seed-"));
console.log(`Tạo ${IMAGES.length} ảnh minh hoạ trong ${dir}`);

for (const image of IMAGES) {
	const file = join(dir, image.key.replace(/\//g, "_"));
	writeFileSync(file, renderPlaceholderSvg(image.shape, image));

	const args = [
		"wrangler",
		"r2",
		"object",
		"put",
		`${BUCKET}/${image.key}`,
		"--file",
		file,
		"--content-type",
		"image/svg+xml",
		remote ? "--remote" : "--local",
	];

	try {
		execFileSync("npx", args, { stdio: ["ignore", "ignore", "pipe"] });
		console.log(`  ✓ ${image.key}`);
	} catch (error) {
		console.error(`  ✗ ${image.key}: ${error.stderr?.toString().trim() ?? error.message}`);
		process.exitCode = 1;
	}
}

console.log(remote ? "Đã nạp ảnh lên R2 (remote)." : "Đã nạp ảnh vào R2 local.");
