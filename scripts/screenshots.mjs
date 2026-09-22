#!/usr/bin/env node
/**
 * Chụp ảnh màn hình cho phần preview trong README.
 *
 * Storefront chụp ở khung điện thoại 390×844, đúng một màn hình — không chụp
 * trọn trang, vì thanh điều hướng dưới dùng `position: fixed` và ảnh full-page
 * sẽ đặt nó lù lù ở giữa trang. Muốn thấy phần dưới thì dùng `scrollTo`.
 *
 * Trang quản trị chụp trọn trang ở khung laptop 1440×900 — ở đây không có phần
 * tử nào ghim đáy màn hình nên ảnh dài vẫn đúng bố cục.
 *
 * Yêu cầu: `npm run dev` đang chạy, và đã có dữ liệu (`npm run db:seed`,
 * `npm run db:seed-orders`).
 *
 * Dùng:
 *   npm run screenshots
 *   npm run screenshots -- --url=http://localhost:5173 --user=thuy --pass=...
 */

import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const args = Object.fromEntries(
	process.argv.slice(2).map((arg) => {
		const [key, ...rest] = arg.replace(/^--/, "").split("=");
		return [key, rest.join("=") || true];
	}),
);

const BASE = (args.url ?? "http://localhost:5173").replace(/\/$/, "");
const USER = args.user ?? "thuy";
const PASS = args.pass ?? "Lumi@2026";
const OUT = "screenshots";

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const DEMO_PRODUCT = "dam-hoa-nhi-tay-bong";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

try {
	// Chụp quản trị trước để lấy mã đơn + số điện thoại, dùng cho ảnh trang
	// theo dõi đơn ở phía khách.
	const orderRef = await shootAdmin();
	await shootStorefront(orderRef);
	console.log(`\nXong. Ảnh nằm trong ./${OUT}/`);
} finally {
	await browser.close();
}

// ---------------------------------------------------------------------------
// Storefront
// ---------------------------------------------------------------------------

async function shootStorefront(orderRef) {
	console.log("\nStorefront (khung điện thoại 390×844)");
	const context = await browser.newContext({
		viewport: MOBILE,
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true,
		locale: "vi-VN",
	});
	const page = await context.newPage();

	const variantId = await firstAvailableVariantId(page);
	if (variantId) {
		await page.request.post(`${BASE}/api/gio-hang`, {
			form: {
				intent: "add",
				variantId: String(variantId),
				quantity: "1",
				redirectTo: "/gio-hang",
			},
		});
	}

	await capture(page, { file: "01-trang-chu", path: "/" });
	await capture(page, { file: "02-trang-chu-san-pham", path: "/", scrollTo: 1150 });
	await capture(page, { file: "03-danh-sach-nu", path: "/nu" });
	await capture(page, { file: "04-danh-sach-tre-em", path: "/tre-em" });
	await capture(page, { file: "05-chi-tiet-san-pham", path: `/san-pham/${DEMO_PRODUCT}` });
	await capture(page, {
		file: "06-chon-size-mau",
		path: `/san-pham/${DEMO_PRODUCT}`,
		scrollTo: 620,
	});

	if (variantId) {
		await capture(page, { file: "07-gio-hang", path: "/gio-hang" });
		await capture(page, { file: "08-thanh-toan", path: "/thanh-toan" });
		await capture(page, { file: "09-thanh-toan-phuong-thuc", path: "/thanh-toan", scrollTo: 620 });
	} else {
		console.log("  – giỏ hàng & thanh toán (bỏ qua: không lấy được sản phẩm còn hàng)");
	}

	await capture(page, { file: "10-tra-cuu-don-hang", path: "/tra-cuu-don-hang" });

	// Trang theo dõi đơn chỉ mở sau khi nhập đúng mã + số điện thoại, nên phải
	// đi qua đúng biểu mẫu tra cứu thay vì gọi thẳng URL.
	if (orderRef) {
		await page.goto(`${BASE}/tra-cuu-don-hang`, { waitUntil: "networkidle" });
		await page.fill('input[name="code"]', orderRef.code);
		await page.fill('input[name="phone"]', orderRef.phone);
		await Promise.all([
			page.waitForURL((url) => url.pathname.startsWith("/don-hang/"), { timeout: 15_000 }),
			page.click('button[type="submit"]'),
		]).catch(() => {});

		if (page.url().includes("/don-hang/")) {
			await capture(page, { file: "11-theo-doi-don-hang", path: new URL(page.url()).pathname });
			await capture(page, {
				file: "12-huong-dan-chuyen-khoan",
				path: new URL(page.url()).pathname,
				scrollTo: 330,
			});
		} else {
			console.log("  – theo dõi đơn hàng (bỏ qua: tra cứu không thành công)");
		}
	}

	await context.close();
}

// ---------------------------------------------------------------------------
// Quản trị
// ---------------------------------------------------------------------------

async function shootAdmin() {
	console.log("Quản trị (khung laptop 1440×900)");
	const context = await browser.newContext({ viewport: DESKTOP, locale: "vi-VN" });
	const page = await context.newPage();

	// Màn đăng nhập phải chụp khi còn chưa có phiên
	await capture(page, { file: "20-admin-dang-nhap", path: "/admin/dang-nhap" });

	await page.goto(`${BASE}/admin/dang-nhap`, { waitUntil: "networkidle" });
	await page.fill('input[name="username"]', USER);
	await page.fill('input[name="password"]', PASS);
	await Promise.all([
		page.waitForURL((url) => !url.pathname.includes("dang-nhap"), { timeout: 15_000 }),
		page.click('button[type="submit"]'),
	]).catch(() => {});

	if (page.url().includes("dang-nhap")) {
		console.error(
			`\nKhông đăng nhập được bằng "${USER}". Tạo tài khoản rồi chạy lại:\n` +
				`  node scripts/create-admin.mjs ${USER} '<mật khẩu>' 'Tên hiển thị'\n`,
		);
		await context.close();
		process.exitCode = 1;
		return null;
	}

	await capture(page, { file: "21-admin-tong-quan", path: "/admin", full: true });
	await capture(page, { file: "22-admin-san-pham", path: "/admin/san-pham" });

	// Id đổi sau mỗi lần nạp lại dữ liệu, nên lấy từ chính bảng danh sách
	const productId = await firstIdFrom(page, "/admin/san-pham", "/admin/san-pham/");
	if (productId) {
		await capture(page, {
			file: "23-admin-sua-san-pham",
			path: `/admin/san-pham/${productId}`,
			full: true,
		});
	}

	// Khối đăng Threads nằm cuối trang sửa sản phẩm, cuộn xuống mới thấy.
	// Ảnh chụp sản phẩm đã có lịch sử đăng để thấy cả phần hẹn giờ lẫn lịch sử.
	const threadsProductId = await firstIdFrom(
		page,
		"/admin/san-pham",
		"/admin/san-pham/",
	);
	if (threadsProductId) {
		await capture(page, {
			file: "24-admin-dang-threads",
			path: `/admin/san-pham/${threadsProductId}`,
			scrollToBottom: true,
		});
	}

	await capture(page, { file: "25-admin-don-hang", path: "/admin/don-hang" });

	const orderRef = await firstOrderRef(page);
	if (orderRef) {
		await capture(page, {
			file: "26-admin-chi-tiet-don",
			path: `/admin/don-hang/${orderRef.id}`,
			full: true,
		});
	} else {
		console.log("  – chi tiết đơn (bỏ qua: chưa có đơn — chạy `npm run db:seed-orders`)");
	}

	await capture(page, { file: "27-admin-khach-hang", path: "/admin/khach-hang" });
	await capture(page, { file: "28-admin-khuyen-mai", path: "/admin/khuyen-mai", full: true });
	await capture(page, { file: "29-admin-bao-cao", path: "/admin/bao-cao", full: true });
	await capture(page, { file: "30-admin-cai-dat", path: "/admin/cai-dat", full: true });

	await context.close();
	return orderRef;
}

// ---------------------------------------------------------------------------

async function capture(page, { file, path, full, scrollTo, scrollToBottom }) {
	const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
	if (!response?.ok()) {
		console.log(`  – ${file} (bỏ qua: ${path} trả ${response?.status() ?? "lỗi mạng"})`);
		return;
	}
	// Chờ webfont để chữ trong ảnh không bị nhảy sang font dự phòng
	await page.evaluate(() => document.fonts.ready);
	if (scrollToBottom) {
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	} else if (scrollTo) {
		await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
	}
	await page.waitForTimeout(350);
	await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: Boolean(full) });
	const note = scrollToBottom ? " (cuộn cuối trang)" : scrollTo ? ` (cuộn ${scrollTo}px)` : "";
	console.log(`  ✓ ${file}.png  ${path}${note}`);
}

/**
 * Id đầu tiên trong một bảng danh sách của trang quản trị.
 * Phải lọc theo id số vì cùng tiền tố còn có link không phải bản ghi,
 * ví dụ "/admin/san-pham/moi" của nút Thêm sản phẩm.
 */
async function firstIdFrom(page, listPath, hrefPrefix) {
	const response = await page.goto(`${BASE}${listPath}`, { waitUntil: "domcontentloaded" });
	if (!response?.ok()) return null;

	const hrefs = await page
		.locator(`a[href^="${hrefPrefix}"]`)
		.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
	for (const href of hrefs) {
		const id = href?.slice(hrefPrefix.length);
		if (/^\d+$/.test(id ?? "")) return id;
	}
	return null;
}

/**
 * Id + mã đơn + số điện thoại của một đơn, đọc từ bảng đơn hàng.
 * Ưu tiên đơn chuyển khoản còn chờ thanh toán, vì đó là màn hình đáng chụp
 * nhất ở phía khách — có mã QR VietQR và hạn giữ hàng.
 */
async function firstOrderRef(page) {
	const response = await page.goto(`${BASE}/admin/don-hang`, { waitUntil: "domcontentloaded" });
	if (!response?.ok()) return null;

	return page.evaluate(() => {
		const rows = [...document.querySelectorAll("tbody tr")].flatMap((row) => {
			const link = row.querySelector('a[href^="/admin/don-hang/"]');
			const id = link?.getAttribute("href")?.split("/").pop();
			const code = link?.textContent?.replace("#", "").trim();
			const text = row.textContent ?? "";
			const phone = text.match(/0\d{9}/)?.[0];
			if (!id || !code || !phone) return [];
			// COD thì không có màn hình quét mã, nên chỉ nhận đơn trả trước
			const awaitingTransfer = /Chờ thanh toán/.test(text) && !/COD/.test(text);
			return [{ id, code, phone, awaitingTransfer }];
		});
		return rows.find((row) => row.awaitingTransfer) ?? rows[0] ?? null;
	});
}

/** Id một biến thể còn hàng, lấy từ chính trang sản phẩm chứ không đụng vào DB */
async function firstAvailableVariantId(page) {
	const response = await page.goto(`${BASE}/san-pham/${DEMO_PRODUCT}`, {
		waitUntil: "networkidle",
	});
	if (!response?.ok()) return null;

	// Nút chọn màu cũng có aria-pressed, nhưng luôn kèm title là tên màu —
	// loại chúng ra để chỉ còn nút chọn size.
	const sizeButton = page
		.locator("button[aria-pressed]:not([disabled]):not([title])")
		.first();
	if ((await sizeButton.count()) === 0) return null;

	// Nút chỉ có tác dụng sau khi React hydrate; click sớm thì không có gì xảy ra
	// và input ẩn vẫn rỗng.
	await sizeButton.click();
	const variantInput = page.locator('input[name="variantId"]');
	await variantInput
		.and(page.locator(':not([value=""])'))
		.waitFor({ timeout: 10_000 })
		.catch(() => {});

	const value = await variantInput.inputValue();
	return value ? Number.parseInt(value, 10) : null;
}
