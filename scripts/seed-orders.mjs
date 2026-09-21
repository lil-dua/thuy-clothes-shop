#!/usr/bin/env node
/**
 * Tạo vài đơn hàng mẫu ở nhiều trạng thái khác nhau, để xem thử trang quản trị
 * và để chụp ảnh preview cho README.
 *
 * Đơn được đặt qua ĐÚNG luồng thanh toán thật (không chèn thẳng SQL), nên tồn
 * kho, lượt bán, tổng chi tiêu của khách và lượt dùng mã giảm giá đều khớp.
 *
 * Yêu cầu: `npm run dev` đang chạy ở cửa sổ khác.
 *
 * Dùng:  npm run db:seed-orders
 *        npm run db:seed-orders -- --url=http://localhost:5173 --user=thuy --pass=...
 */

import { execFileSync } from "node:child_process";

const args = Object.fromEntries(
	process.argv.slice(2).map((arg) => {
		const [key, ...rest] = arg.replace(/^--/, "").split("=");
		return [key, rest.join("=") || true];
	}),
);

const BASE = (args.url ?? "http://localhost:5173").replace(/\/$/, "");
const USER = args.user ?? "thuy";
const PASS = args.pass ?? "Lumi@2026";

const CUSTOMERS = [
	{
		name: "Nguyễn Thị Hoa",
		phone: "0912345678",
		address: "12 Lê Văn Lương, Thanh Xuân, Hà Nội",
		payment: "cod",
		quantity: 1,
		/** Trạng thái muốn đưa đơn về sau khi đặt */
		advance: ["confirmed"],
	},
	{
		name: "Trần Văn Minh",
		phone: "0933222111",
		address: "88 Nguyễn Trãi, Quận 5, TP.HCM",
		payment: "bank_transfer",
		quantity: 2,
		discount: "CHAOBAN",
		advance: ["paid", "shipping"],
	},
	{
		name: "Lê Thị Mai",
		phone: "0977888999",
		address: "5 Trần Phú, Hải Châu, Đà Nẵng",
		payment: "momo",
		quantity: 1,
		advance: [],
	},
	{
		name: "Phạm Đức Anh",
		phone: "0908777666",
		address: "34 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội",
		payment: "cod",
		quantity: 3,
		advance: ["confirmed", "shipping", "delivered"],
	},
	{
		name: "Hoàng Thu Hà",
		phone: "0966555444",
		address: "21 Phan Đình Phùng, Ba Đình, Hà Nội",
		payment: "cod",
		quantity: 1,
		advance: ["cancelled"],
	},
	{
		// Cố ý để nguyên trạng thái chờ thanh toán, để còn thấy màn quét mã
		// VietQR kèm hạn giữ hàng ở phía khách.
		name: "Đỗ Khánh Linh",
		phone: "0944333222",
		address: "7 Nguyễn Huệ, Quận 1, TP.HCM",
		payment: "bank_transfer",
		quantity: 1,
		advance: [],
	},
];

const variantIds = queryVariantIds(CUSTOMERS.length);
if (variantIds.length === 0) {
	console.error("Không tìm thấy sản phẩm nào còn hàng. Chạy `npm run db:seed` trước.");
	process.exit(1);
}

const adminCookies = await loginAdmin();

for (const [index, customer] of CUSTOMERS.entries()) {
	const variantId = variantIds[index % variantIds.length];
	const code = await placeOrder(customer, variantId);
	if (!code) continue;

	const orderId = await findOrderId(code);
	for (const step of customer.advance) {
		if (step === "paid") {
			await adminPost(orderId, { intent: "mark-paid" });
		} else {
			await adminPost(orderId, { intent: "status", status: step });
		}
	}
	console.log(`  ✓ ${code}  ${customer.name}  ${customer.payment}  → ${customer.advance.at(-1) ?? "pending"}`);
}

console.log("\nXong. Mở /admin để xem.");

// ---------------------------------------------------------------------------

/**
 * Đọc id biến thể còn hàng, mỗi sản phẩm một biến thể, rồi xen kẽ đồ nữ và đồ
 * trẻ em — nếu lấy tuần tự thì cả bộ đơn mẫu rơi hết vào đồ nữ và biểu đồ
 * "Tiền hàng theo nhóm" sẽ hiện Trẻ em 0đ.
 */
function queryVariantIds(limit) {
	const sql = `SELECT MIN(v.id) AS id, c.target_group AS grp
	             FROM product_variants v
	             JOIN products p ON p.id = v.product_id
	             LEFT JOIN categories c ON c.id = p.category_id
	             WHERE v.quantity >= 3 AND v.is_active = 1 AND p.status = 'active'
	             GROUP BY v.product_id ORDER BY v.product_id`;
	try {
		const raw = execFileSync(
			"npx",
			["wrangler", "d1", "execute", "lumi-shop-db", "--local", "--json", "--command", sql],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		const rows = JSON.parse(raw)[0].results;
		const women = rows.filter((row) => row.grp === "women").map((row) => row.id);
		const kids = rows.filter((row) => row.grp === "kids").map((row) => row.id);

		const mixed = [];
		while (mixed.length < limit && (women.length || kids.length)) {
			if (women.length) mixed.push(women.shift());
			if (mixed.length < limit && kids.length) mixed.push(kids.shift());
		}
		return mixed;
	} catch (error) {
		console.error("Không đọc được database local:", error.stderr?.toString() ?? error.message);
		return [];
	}
}

async function placeOrder(customer, variantId) {
	const jar = new Map();

	await post("/api/gio-hang", jar, {
		intent: "add",
		variantId: String(variantId),
		quantity: String(customer.quantity),
		redirectTo: "/gio-hang",
	});

	if (customer.discount) {
		await post("/gio-hang", jar, { intent: "discount", code: customer.discount });
	}

	const response = await post("/thanh-toan", jar, {
		customerName: customer.name,
		customerPhone: customer.phone,
		customerAddress: customer.address,
		paymentMethod: customer.payment,
	});

	const location = response.headers.get("location") ?? "";
	const code = location.split("/").pop();
	if (!code?.startsWith("LUMI")) {
		console.error(`  ✗ ${customer.name}: đặt hàng không thành công (${location || response.status})`);
		return null;
	}
	return code;
}

async function findOrderId(code) {
	const raw = execFileSync(
		"npx",
		[
			"wrangler", "d1", "execute", "lumi-shop-db", "--local", "--json",
			"--command", `SELECT id FROM orders WHERE order_code = '${code}'`,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	return JSON.parse(raw)[0].results[0].id;
}

async function loginAdmin() {
	const jar = new Map();
	const response = await post("/admin/dang-nhap", jar, { username: USER, password: PASS });
	if (response.status !== 302) {
		console.error(
			`Không đăng nhập được bằng "${USER}". Tạo tài khoản rồi chạy lại:\n` +
				`  node scripts/create-admin.mjs ${USER} '<mật khẩu>' 'Tên hiển thị'`,
		);
		process.exit(1);
	}
	return jar;
}

function adminPost(orderId, body) {
	return post(`/admin/don-hang/${orderId}`, adminCookies, body);
}

/** POST dạng form, tự gom cookie vào `jar` và không đi theo redirect */
async function post(path, jar, body) {
	const response = await fetch(`${BASE}${path}`, {
		method: "POST",
		redirect: "manual",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			...(jar.size > 0 && { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }),
		},
		body: new URLSearchParams(body).toString(),
	});

	for (const raw of response.headers.getSetCookie()) {
		const [pair] = raw.split(";");
		const index = pair.indexOf("=");
		if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
	}
	return response;
}
