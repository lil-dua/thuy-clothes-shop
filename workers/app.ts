import { createRequestHandler } from "react-router";
import { releaseExpiredOrders } from "../app/lib/order.server";
import { getSecret, getSettings } from "../app/lib/settings.server";
import { syncScheduledPosts } from "../app/lib/threads.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

/**
 * Header bảo mật áp cho MỌI response (trang HTML lẫn resource route như
 * /anh/*, CSV, sitemap...) — đặt một chỗ duy nhất ở đây thay vì rải khắp
 * từng route. Không ghi đè nếu route đã tự set (ví dụ đã có Content-Type
 * riêng thì vẫn giữ).
 *
 * CSP để dạng Report-Only: React Router chèn một <script> inline chứa dữ
 * liệu hydrate (window.__reactRouterContext = ...) mà không có cách gắn
 * nonce trong bản framework hiện tại, và vài biểu đồ trong trang quản trị
 * dùng thuộc tính `style` inline (độ rộng thanh doanh thu theo %). Chặn cứng
 * script-src/style-src sẽ làm trắng trang admin và hỏng hydration. Bật
 * Report-Only trước để có dữ liệu thật trước khi cân nhắc siết chặt hơn.
 */
const SECURITY_HEADERS: [string, string][] = [
	["X-Content-Type-Options", "nosniff"],
	["Referrer-Policy", "strict-origin-when-cross-origin"],
	["X-Frame-Options", "DENY"],
	["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
];

const CSP_REPORT_ONLY = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"font-src 'self' https://fonts.gstatic.com",
	"img-src 'self' data: https://img.vietqr.io",
	"connect-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"form-action 'self'",
].join("; ");

function withSecurityHeaders(request: Request, response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of SECURITY_HEADERS) {
		if (!headers.has(key)) headers.set(key, value);
	}
	if (new URL(request.url).protocol === "https:" && !headers.has("Strict-Transport-Security")) {
		// 2 năm + preload: đủ dài để đăng ký HSTS preload list nếu cần sau này.
		headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
	}
	if (!headers.has("Content-Security-Policy-Report-Only") && !headers.has("Content-Security-Policy")) {
		headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * Chốt CSRF ở một chỗ duy nhất: mọi request KHÔNG phải GET/HEAD phải có
 * header `Origin` cùng host với chính request đó, nếu có gửi header này lên.
 *
 * Cookie đã đặt `sameSite: "lax"` nên trình duyệt hiện đại đã tự chặn phần
 * lớn request ghi (POST) khởi từ site khác — đây chỉ là lớp phòng thủ thêm
 * (defense in depth) cho trường hợp trình duyệt cũ/lỗi không tôn trọng
 * SameSite. KHÔNG chặn khi thiếu header `Origin` hẳn: một số client hợp lệ
 * (script nội bộ dùng `fetch`/`curl` khi test, một số trình duyệt cũ) không
 * luôn gửi header này cho request cùng gốc, và chặn nhầm sẽ làm hỏng luồng
 * mua hàng thật.
 */
function hasTrustedOrigin(request: Request): boolean {
	const origin = request.headers.get("Origin");
	if (!origin) return true;
	try {
		return new URL(origin).host === new URL(request.url).host;
	} catch {
		return false;
	}
}

export default {
	async fetch(request, env, ctx) {
		if (
			!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
			!hasTrustedOrigin(request)
		) {
			return withSecurityHeaders(
				request,
				new Response("Từ chối: nguồn gốc yêu cầu không hợp lệ", { status: 403 }),
			);
		}

		const response = await requestHandler(request, {
			cloudflare: { env, ctx },
		});
		return withSecurityHeaders(request, response);
	},

	/**
	 * Chạy theo lịch trong wrangler.json (mỗi 15 phút).
	 *
	 * Hai việc, đều là dọn dẹp nền:
	 *
	 * 1. Trả kho cho đơn chuyển khoản/MoMo quá hạn giữ chỗ. Trong request cũng
	 *    đã làm việc này, nhưng nếu cả đêm không ai vào web thì hàng vẫn bị giữ
	 *    treo tới sáng — cron lấp đúng khoảng đó.
	 *
	 * 2. Hỏi lại Typefully xem bài đã hẹn giờ lên sóng chưa. Việc ĐĂNG là của
	 *    Typefully, cron không đăng hộ; nó chỉ cập nhật lại trạng thái để trang
	 *    quản trị không hiển thị "Đã hẹn giờ" mãi sau khi bài đã đăng xong.
	 */
	async scheduled(_event, env, ctx) {
		ctx.waitUntil(
			(async () => {
				const released = await releaseExpiredOrders(env.DB);
				if (released > 0) {
					console.log(`[cron] đã huỷ và hoàn kho ${released} đơn quá hạn`);
				}

				const apiKey = await getSecret(
					env.DB,
					"typefully_api_key",
					env as unknown as Record<string, unknown>,
				);
				if (!apiKey) return;

				const settings = await getSettings(env.DB);
				const synced = await syncScheduledPosts(env.DB, apiKey, settings);
				if (synced > 0) {
					console.log(`[cron] đã cập nhật trạng thái ${synced} bài đăng`);
				}
			})(),
		);
	},
} satisfies ExportedHandler<Env>;
