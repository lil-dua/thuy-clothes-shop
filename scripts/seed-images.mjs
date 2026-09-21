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

/** Dáng quần áo vẽ đơn giản, đặt trong khung 800x1000 */
const SHAPES = {
	dress: `<path d="M300 300h200l40 90-60 30 25 320H295l25-320-60-30z"/>
	        <path d="M300 300q100 60 200 0"/>`,
	maxi: `<path d="M340 290h120l50 110-55 20 40 340H305l40-340-55-20z"/>`,
	babydoll: `<path d="M310 300h180l45 95-55 25 15 260H305l15-260-55-25z"/>`,
	tee: `<path d="M295 300h210l70 70-55 55-15-25v290H295V400l-15 25-55-55z"/>`,
	shirt: `<path d="M300 295h200l75 75-60 55-15-20v285H300V405l-15 20-60-55z"/>
	        <path d="M400 300v390"/>`,
	pants: `<path d="M320 320h160v70l-20 320h-55l-25-250-25 250h-55l-20-320z"/>`,
	skirt: `<path d="M330 320h140l60 350H270z"/>`,
	set: `<path d="M305 285h190l60 62-50 46-12-18v130H307V375l-12 18-50-46z"/>
	      <path d="M320 530h160v60l-18 170h-50l-12-130-12 130h-50l-18-170z"/>`,
	kidsdress: `<path d="M330 320h140l30 70-45 22 40 250H305l40-250-45-22z"/>
	            <circle cx="400" cy="300" r="26"/>`,
	shorts: `<path d="M325 350h150v60l-15 160h-50l-10-120-10 120h-50l-15-160z"/>`,
	hat: `<ellipse cx="400" cy="520" rx="185" ry="60"/>
	      <path d="M280 520q0-150 120-150t120 150"/>`,
};

function svgFor({ shape, from, to, accent, label }) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
			<stop offset="0%" stop-color="${from}"/>
			<stop offset="100%" stop-color="${to}"/>
		</linearGradient>
	</defs>
	<rect width="800" height="1000" fill="url(#bg)"/>
	<circle cx="650" cy="160" r="120" fill="#ffffff" opacity="0.35"/>
	<circle cx="140" cy="820" r="90" fill="#ffffff" opacity="0.25"/>
	<g fill="#ffffff" fill-opacity="0.85" stroke="${accent}" stroke-width="7"
	   stroke-linejoin="round" stroke-linecap="round">
		${SHAPES[shape]}
	</g>
	<text x="400" y="930" text-anchor="middle" font-family="system-ui, sans-serif"
	      font-size="30" fill="${accent}" opacity="0.85">${label}</text>
</svg>`;
}

const dir = mkdtempSync(join(tmpdir(), "lumi-seed-"));
console.log(`Tạo ${IMAGES.length} ảnh minh hoạ trong ${dir}`);

for (const image of IMAGES) {
	const file = join(dir, image.key.replace(/\//g, "_"));
	writeFileSync(file, svgFor(image));

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
